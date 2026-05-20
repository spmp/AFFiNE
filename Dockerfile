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
RUN yarn config set nmMode classic || true
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
RUN yarn affine @affine/web build
RUN yarn affine @affine/admin build
RUN yarn affine @affine/mobile build

# Generate Prisma client
RUN yarn config set --json supportedArchitectures.cpu '["x64", "arm64", "arm"]'
RUN yarn config set --json supportedArchitectures.libc '["glibc"]'
RUN yarn workspaces focus @affine/server --production
RUN yarn workspace @affine/server prisma generate

# Move node_modules
RUN mv ./node_modules ./packages/backend/server

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
