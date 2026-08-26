# Build context must be the monorepo root (not apps/backend), since this
# needs pnpm-workspace.yaml and packages/shared. In Coolify: set "Base
# Directory" to / and "Dockerfile Location" to apps/backend/Dockerfile.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Workspace manifests only — this layer is what makes the two installs below
# cacheable across deploys that only touch source files.
FROM base AS manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/backend/package.json apps/backend/package.json

FROM manifests AS deps
RUN pnpm install --frozen-lockfile

FROM deps AS build
# tsconfig.base.json lives at the repo root and is extended by both
# packages/shared and apps/backend tsconfigs — without it, tsc can't read
# the shared compilerOptions (target/lib ES2022) and the build fails.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
# Also builds @eyewear/shared first (see the backend's "build" script).
# Output lands in apps/backend/.medusa/server (see apps/backend/tsconfig.json).
RUN pnpm --filter @eyewear/backend build

# ---------------------------------------------------------------------------
# runner — a production-only install that the final image is layered directly
# on top of, so the compiled output is the only thing copied in.
#
# Copying node_modules across stages is what killed the first Coolify deploy:
# it writes a second full-size layer that the daemon then has to export, and
# the free-tier VM does not have the headroom for it. Building *on* the
# install instead means that layer never exists.
#
# The pnpm symlink farm is kept rather than reinstalling inside
# .medusa/server with npm — the package.json Medusa copies there references
# @eyewear/shared as `workspace:*`, which npm cannot resolve outside the
# monorepo.
# ---------------------------------------------------------------------------
FROM manifests AS runner
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/backend/.medusa/server ./apps/backend/.medusa/server

# ---------------------------------------------------------------------------
# vision-measure (Python/FastAPI) — bundled into this image as a second
# process rather than its own Coolify app, so the try-on's "AI option 2"
# doesn't cost a second app/domain/CORS allowlist to run. Reached only via
# src/api/vision-measure/proxy.ts on http://127.0.0.1:8008 (see
# docker-entrypoint.sh); never exposed on its own.
#
# Alpine ships no Python. Astral's own install script picks the correct
# (musl) build for it, which trusting a `COPY --from=ghcr.io/astral-sh/uv:*`
# image tag to be musl-linked cannot guarantee.
#
# PYTHONUTF8 matters here specifically: Alpine has no locale data, so without
# it a message containing a plain "→" (services/vision_measure/measure.py's
# own error annotations) crashes the request with UnicodeEncodeError instead
# of returning the friendly error the panel expects.
# ---------------------------------------------------------------------------
RUN apk add --no-cache python3 curl && \
    curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"
ENV PYTHONUTF8=1

COPY apps/vision-measure/pyproject.toml apps/vision-measure/uv.lock /app/vision-measure/
WORKDIR /app/vision-measure
# --no-install-project mirrors [tool.uv] package = false in that pyproject.toml
# — vision_api.py resolves its own repo root at runtime and needs no install
# step for "services" itself, only its third-party dependencies.
RUN uv sync --frozen --no-install-project --no-dev
COPY apps/vision-measure/services /app/vision-measure/services
WORKDIR /app

COPY apps/backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# `medusa start` derives everything from the working directory —
# @medusajs/cli does `path.resolve(".")` and looks for medusa-config, src/**
# and public/admin under it. Started anywhere else it dies with
# "Cannot find module '<cwd>/medusa-config'", because this image ships the
# compiled output only, never the sources. docker-entrypoint.sh does its own
# `cd` before starting Medusa for exactly this reason.
WORKDIR /app/apps/backend/.medusa/server

EXPOSE 9000
CMD ["/app/docker-entrypoint.sh"]
