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

# `medusa start` resolves medusa-config.js, src/** and public/admin relative
# to the working directory, so it must run from the build output folder.
WORKDIR /app/apps/backend/.medusa/server

EXPOSE 9000
CMD ["/app/apps/backend/node_modules/.bin/medusa", "start", "-H", "0.0.0.0"]
