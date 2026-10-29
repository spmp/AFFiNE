# syntax=docker/dockerfile:1-labs
#
# Layered AFFiNE build. Each stage copies only the files it needs, so a
# change rebuilds only the stages that depend on it (BuildKit compares the
# copied files by content):
#
#   toolchain  apt packages, Rust (pinned by rust-toolchain.toml), Bun
#   manifests  every package.json, extracted from the build context
#   deps       yarn install            <- package.json files, yarn.lock, tools/
#   native     @affine/server-native   <- Rust crates, Cargo.toml/lock
#   server     @affine/server bundle   <- packages/backend, packages/common
#   web        web/admin/mobile        <- blocksuite, packages/common, packages/frontend
#              (native, server and web build one after another, not in parallel)
#   prod-deps  production node_modules <- package.json files, schema.prisma
#   production the runtime image, assembled from the stages above
#
# GITHUB_SHA is only used to stamp the commit into the frontend HTML and
# assets manifest. It is applied in the final stage, so a new commit doesn't
# rebuild anything. Pass it to label the build:
#   --build-arg GITHUB_SHA=$(git rev-parse HEAD)
#
# To force one stage (and everything after it) to rebuild, give its
# REBUILD_* argument a new value, e.g. --build-arg REBUILD_WEB=$(date +%s).
#
# Originally based on work by Sander Sneekes:
# https://sneekes.app/posts/building_a_production_ready-_affine_docker_image_with_custom-_ai_models/

FROM node:22-bookworm-slim AS toolchain

# Temporary build limits to avoid server overheat
#ARG BUILD_JOBS=2
#ENV CARGO_BUILD_JOBS=${BUILD_JOBS} \
#    RAYON_NUM_THREADS=${BUILD_JOBS} \
#    UV_THREADPOOL_SIZE=${BUILD_JOBS}

RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    build-essential \
    libssl-dev \
    pkg-config \
    curl \
    jq \
    unzip \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.cargo/bin:/root/.bun/bin:${PATH}"
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
RUN curl -fsSL https://bun.sh/install | bash
RUN corepack enable

ENV HUSKY=0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    SENTRYCLI_SKIP_DOWNLOAD=1

WORKDIR /affine
# Install the pinned Rust toolchain once, here, instead of inside the native build.
COPY rust-toolchain.toml ./
RUN rustup toolchain install "$(sed -n 's/^channel *= *"\(.*\)"/\1/p' rust-toolchain.toml)" --profile minimal


# Every package.json from the build context, nothing else. This stage reruns
# on any context change but is cheap; `deps` only reruns when its output (the
# manifests) actually changes.
FROM toolchain AS manifests
COPY . /src
RUN cd /src && find . -name package.json -not -path '*/node_modules/*' \
      -exec cp --parents {} /affine/ \;


FROM toolchain AS deps
ARG REBUILD_DEPS=
RUN echo "deps rebuild token: ${REBUILD_DEPS}"
COPY --from=manifests /affine/ ./
COPY yarn.lock .yarnrc.yml tsconfig.json .oxlintrc.json .prettierrc .prettierignore ./
COPY .yarn/releases .yarn/releases
COPY .yarn/patches .yarn/patches
# Needed by install scripts: the root postinstall (`yarn affine init`, whose
# CLI imports @affine/s3-compat from source), the templates package's
# `yarn build` (writes into core/public/static, which must exist) and the
# server's `prisma generate`.
COPY tools tools
COPY packages/common/s3-compat packages/common/s3-compat
COPY packages/frontend/templates packages/frontend/templates
COPY packages/backend/server/schema.prisma packages/backend/server/schema.prisma
RUN mkdir -p packages/frontend/core/public/static

# Optionally override package versions with a valid SemVer value.
# Do NOT use floating labels like "canary" here; many runtime checks require SemVer.
ARG BUILD_VERSION=
# Guard against a non-SemVer BUILD_VERSION getting baked into every package.json.
# The backend WebSocket sync gateway's isSupportedWsClientVersion check
# (packages/backend/server/src/core/sync/gateway.ts) validates the client's version with
# semver.valid()/semver.Range on every space:join message; an invalid version here silently
# disconnects every client built from this image in a reconnect loop.
RUN if [ -n "${BUILD_VERSION}" ] && ! printf '%s' "${BUILD_VERSION}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'; then echo "ERROR: BUILD_VERSION='${BUILD_VERSION}' is not valid SemVer (e.g. 1.2.3, 1.2.3-beta.1, 1.2.3+20260826)" >&2; exit 1; fi
RUN if [ -n "${BUILD_VERSION}" ]; then \
      find . -name "package.json" -type f -not -path '*/node_modules/*' \
        -exec sed -i 's/"version": "[^"]*"/"version": "'"${BUILD_VERSION}"'"/' {} \;; \
    fi

RUN yarn config set enableScripts true
# (nmMode is left at the repo default, hardlinks-local.)
RUN --mount=type=cache,target=/root/.yarn/berry/cache,sharing=locked \
    yarn install --inline-builds
RUN chmod +x node_modules/.bin/* || true


FROM deps AS native
ARG REBUILD_NATIVE=
RUN echo "native rebuild token: ${REBUILD_NATIVE}"
COPY Cargo.toml Cargo.lock ./
COPY .cargo .cargo
# Cargo needs every workspace member present, not just the server crate.
COPY --exclude=**/package.json packages/backend/native packages/backend/native
COPY --exclude=**/package.json packages/common/native packages/common/native
COPY --exclude=**/package.json packages/frontend/native packages/frontend/native
COPY --exclude=**/package.json packages/frontend/mobile-native packages/frontend/mobile-native
# The workspace Cargo.toml's [profile.release] uses codegen-units=1 + fat LTO,
# which makes the final codegen/link pass almost single-threaded. Override it
# for this throw-away Docker build only (real release builds elsewhere keep
# fat LTO).
ENV CARGO_PROFILE_RELEASE_LTO=thin \
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
    CARGO_TARGET_DIR=/affine/target
RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=cache,target=/affine/target \
    yarn workspace @affine/server-native build \
    && cd packages/backend/native \
    && cp server-native.node server-native.x64.node \
    && cp server-native.node server-native.arm64.node \
    && cp server-native.node server-native.armv7.node


FROM deps AS server
ARG REBUILD_SERVER=
RUN echo "server rebuild: ${REBUILD_SERVER}"
# The real root tsconfig (deps' postinstall regenerated it without references).
COPY tsconfig.json tsconfig.node.json tsconfig.web.json ./
COPY --exclude=**/package.json packages/backend packages/backend
COPY --exclude=**/package.json packages/common packages/common
COPY --from=native /affine/packages/backend/native/*.node packages/backend/native/
ARG BUILD_TYPE=canary
ENV BUILD_TYPE=${BUILD_TYPE} \
    PUBLIC_PATH=/ \
    NODE_OPTIONS="--max_old_space_size=4096"
RUN yarn workspace @affine/server build
# Ordering marker for the web stage (constant content, see there).
RUN mkdir -p /stage && echo done > /stage/server-done


FROM deps AS web
ARG REBUILD_WEB=
RUN echo "web rebuild: ${REBUILD_WEB}"
# The real root tsconfig (deps' postinstall regenerated it without references).
COPY tsconfig.json tsconfig.node.json tsconfig.web.json ./
COPY --exclude=**/package.json blocksuite blocksuite
COPY --exclude=**/package.json packages/common packages/common
COPY --exclude=**/package.json packages/frontend packages/frontend
ARG BUILD_TYPE=canary
# A fixed placeholder commit hash, replaced in the production stage, so the
# commit never invalidates these builds.
ENV BUILD_TYPE=${BUILD_TYPE} \
    PUBLIC_PATH=/ \
    NODE_OPTIONS="--max_old_space_size=4096" \
    GITHUB_SHA=gitsha000
# @affine/mobile is built even though its bundle is only *served* when
# env.namespaces.canary is true - DocRendererController's constructor
# (core/doc-renderer/controller.ts) unconditionally reads
# static/mobile/assets-manifest.json at boot and throws in production if
# it's missing, regardless of the canary gate. Do not remove this build.
# Set AFFINE_ENV=dev at runtime to enable mobile to be served
# Run the heavy builds one after another (native -> server -> web) instead of
# in parallel: on a small machine a Rust release build and the rspack builds
# together exhaust memory and swap. The marker's content never changes, so a
# server rebuild doesn't invalidate this stage's cache.
COPY --from=server /stage/server-done /stage/server-done
# Each build is checked for its index.html and assets-manifest.json: the CLI
# exits 0 even when the main app compilation fails and only the workers and
# service worker get emitted.
RUN yarn affine @affine/web build \
    && test -f packages/frontend/apps/web/dist/index.html \
    && test -f packages/frontend/apps/web/dist/assets-manifest.json
RUN yarn affine @affine/admin build \
    && test -f packages/frontend/admin/dist/index.html \
    && test -f packages/frontend/admin/dist/assets-manifest.json
RUN yarn affine @affine/mobile build \
    && test -f packages/frontend/apps/mobile/dist/index.html \
    && test -f packages/frontend/apps/mobile/dist/assets-manifest.json


FROM deps AS prod-deps
RUN yarn config set --json supportedArchitectures.cpu '["x64", "arm64", "arm"]'
RUN yarn config set --json supportedArchitectures.libc '["glibc"]'
RUN --mount=type=cache,target=/root/.yarn/berry/cache,sharing=locked \
    yarn workspaces focus @affine/server --production
RUN yarn workspace @affine/server prisma generate
# The production stage takes the server's node_modules from here only.
RUN test ! -e packages/backend/server/node_modules \
    || { echo "unexpected packages/backend/server/node_modules" >&2; exit 1; }


FROM node:22-bookworm-slim AS production

ARG GIT_TAG
ARG BUILD_TYPE
ARG BUILD_DATE
ARG AI_MODEL

RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl libjemalloc2 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=server --exclude=node_modules /affine/packages/backend/server /app
COPY --from=prod-deps /affine/node_modules /app/node_modules
COPY --from=web /affine/packages/frontend/apps/web/dist /app/static
COPY --from=web /affine/packages/frontend/admin/dist /app/static/admin
COPY --from=web /affine/packages/frontend/apps/mobile/dist /app/static/mobile

# Fix weird float corruption: rspack's real-content-hash pass rewrote the
# "94853726" inside drawio library numbers (e.g. 0.0862694853726245) to a
# chunk hash, "f6f0289e", in one build. The fix is specific to that build's
# hashes and to the index chunk (the libraries have since moved to lazy
# chunks), so it is skipped when there is no index chunk; the check below
# reports whether the corruption still happens.
RUN for f in /app/static/js/index.*.js; do \
      [ -e "$f" ] || { echo "float fix: no index chunk, skipped"; break; }; \
      sed -i 's/f6f0289e/94853726/g' "$f"; \
    done \
    && if grep -rqF '0862694853726245' /app/static; then \
         echo "float check: drawio literal 0.0862694853726245 intact"; \
       else \
         echo "WARNING float check: drawio literal 0.0862694853726245 not found in /app/static (corrupted, or not in this build)"; \
       fi

# Stamp the commit into the frontend HTML/manifests (see GITHUB_SHA above).
ARG GITHUB_SHA=
RUN sha=$(printf '%s' "${GITHUB_SHA:-unknown}" | cut -c1-9) \
    && grep -rl 'gitsha000' /app/static | xargs -r sed -i "s/gitsha000/${sha}/g"

WORKDIR /app

ENV LD_PRELOAD=libjemalloc.so.2

#LABEL git.tag=${GIT_TAG}
#LABEL build.type=${BUILD_TYPE}
#LABEL build.date=${BUILD_DATE}
#LABEL ai.model=%{AI_MODEL}

EXPOSE 3010

#HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
#    CMD curl -f http://localhost:3010/api/health || exit 1

CMD ["node", "./dist/main.js"]
