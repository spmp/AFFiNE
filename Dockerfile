# Build stage - Complete AFFiNE build process
#
# Originally based on work by Sander Sneekes:
# https://sneekes.app/posts/building_a_production_ready-_affine_docker_image_with_custom-_ai_models/
FROM node:22-bookworm-slim AS builder

# Build arguments
ARG GIT_REPO=https://github.com/spmp/AFFiNE.git
ARG GIT_TAG=pr/N-build
ARG GIT_DEPTH=0
ARG BUILD_VERSION=

# Install system dependencies
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

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /affine

ARG PRE_TOOLING_RND=AsDfJkL

# Clone repository (full history by default for robust patch 3-way apply)
RUN if [ "${GIT_DEPTH}" = "0" ]; then \
      git clone --branch ${GIT_TAG} ${GIT_REPO} .; \
    else \
      git clone --depth ${GIT_DEPTH} --branch ${GIT_TAG} ${GIT_REPO} .; \
    fi

# Optionally override package versions with a valid SemVer value.
# Do NOT use floating labels like "canary" here; many runtime checks require SemVer.
RUN if [ -n "${BUILD_VERSION}" ]; then \
      find . -name "package.json" -type f -exec sed -i 's/"version": "[^"]*"/"version": "'"${BUILD_VERSION}"'"/' {} \;; \
    fi

# Setup Node.js
RUN corepack enable

# Configure yarn
# (nmMode is left at the repo default, hardlinks-local, set in .yarnrc.yml -
# it shares file content across node_modules instead of duplicating it,
# which matters a lot here given yarn install runs 3 times in this build)
RUN yarn config set enableScripts true

# Set environment variables
ENV HUSKY=0
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV SENTRYCLI_SKIP_DOWNLOAD=1

# Install ALL dependencies (don't use workspaces focus yet)
RUN yarn install --inline-builds

# Fix permissions
RUN chmod +x node_modules/.bin/* || true

# Build native components first
# The workspace Cargo.toml's [profile.release] uses codegen-units=1 + fat LTO,
# which is great for the shipped binary but makes the final codegen/link pass
# almost single-threaded - it dwarfs the (parallel) dependency compile time.
# Override it for this throw-away Docker build only, via Cargo's env-based
# profile overrides (does not touch the committed Cargo.toml, so real release
# builds elsewhere, e.g. desktop packaging, keep full fat-LTO).
ENV CARGO_PROFILE_RELEASE_LTO=thin
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
RUN yarn workspaces focus @affine/server-native
RUN yarn workspace @affine/server-native build
RUN cp ./packages/backend/native/server-native.node ./packages/backend/native/server-native.x64.node
RUN cp ./packages/backend/native/server-native.node ./packages/backend/native/server-native.arm64.node
RUN cp ./packages/backend/native/server-native.node ./packages/backend/native/server-native.armv7.node

# IMPORTANT: Reinstall ALL dependencies after native build
RUN yarn install --inline-builds

# Build ALL components in the right order
ENV BUILD_TYPE=${BUILD_TYPE}
ENV NODE_OPTIONS="--max_old_space_size=4096"

# Build core dependencies first
RUN yarn affine bundle -p @affine/reader

# Build server
RUN yarn workspaces focus @affine/server @types/affine__env
RUN yarn workspace @affine/server build

# Reinstall ALL dependencies for frontend builds
RUN yarn install --inline-builds

# Build frontend components (now all dependencies should be available)
# Note: @affine/mobile is built even though its bundle is only *served* when
# env.namespaces.canary is true - DocRendererController's constructor
# (core/doc-renderer/controller.ts) unconditionally reads
# static/mobile/assets-manifest.json at boot and throws in production if
# it's missing, regardless of the canary gate. Do not remove this build.
# Set AFFINE_ENV=dev at runtime to enable mobile to be served
RUN yarn affine @affine/web build
RUN df -h /affine && ls -la packages/frontend/apps/web/dist/ || echo "MISSING RIGHT AFTER web build"
RUN yarn affine @affine/admin build
RUN df -h /affine && ls -la packages/frontend/admin/dist/ || echo "MISSING RIGHT AFTER admin build"
RUN yarn affine @affine/mobile build
RUN df -h /affine && ls -la packages/frontend/apps/mobile/dist/ || echo "MISSING RIGHT AFTER mobile build"

# Generate Prisma client
RUN yarn config set --json supportedArchitectures.cpu '["x64", "arm64", "arm"]'
RUN yarn config set --json supportedArchitectures.libc '["glibc"]'
RUN yarn workspaces focus @affine/server --production
RUN yarn workspace @affine/server prisma generate

# Move node_modules
RUN mv ./node_modules ./packages/backend/server

# Debug: capture disk/memory state and the actual filesystem contents right
# before verifying, since the failure so far has been silent otherwise (every
# prior RUN step reports success). None of these commands can fail the build.
RUN echo "=== disk space ===" && df -h; \
    echo "=== memory ===" && free -h; \
    echo "=== /affine top level ===" && ls -la /affine; \
    echo "=== packages/frontend (recursive, 4 levels, or absence) ===" && \
      (find packages/frontend -maxdepth 4 2>&1 | sort || echo "packages/frontend MISSING ENTIRELY"); \
    echo "=== node_modules top-level entry count ===" && \
      (ls packages/backend/server/node_modules 2>&1 | wc -l || echo "packages/backend/server/node_modules MISSING"); \
    echo "=== dmesg tail (often unavailable in an unprivileged build - check the DOCKER HOST's dmesg/journalctl for OOM kills if this is empty) ===" && \
      (dmesg 2>&1 | tail -50 || echo "dmesg unavailable in this build context"); \
    true

# Verify build artifacts
RUN ls -la packages/backend/server/dist/ && \
    ls -la packages/frontend/apps/web/dist/ && \
    ls -la packages/frontend/admin/dist/ && \
    ls -la packages/frontend/apps/mobile/dist/

# Production stage
FROM node:22-bookworm-slim AS production

ARG GIT_TAG
ARG BUILD_TYPE
ARG BUILD_DATE
ARG AI_MODEL

RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl libjemalloc2 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /affine/packages/backend/server /app
COPY --from=builder /affine/packages/frontend/apps/web/dist /app/static
COPY --from=builder /affine/packages/frontend/admin/dist /app/static/admin
COPY --from=builder /affine/packages/frontend/apps/mobile/dist /app/static/mobile

# Fix weird float corruption
RUN sed -i 's/f6f0289e/94853726/g' /app/static/js/index.*.js

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
