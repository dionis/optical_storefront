# Build context must be the monorepo root (not apps/backend), since this
# needs pnpm-workspace.yaml and packages/shared. In Coolify: set "Base
# Directory" to / and "Dockerfile Location" to apps/backend/Dockerfile.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
# tsconfig.base.json lives at the repo root and is extended by both
# packages/shared and apps/backend tsconfigs — without it, tsc can't read
# the shared compilerOptions (target/lib ES2022) and the build fails.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN pnpm --filter @eyewear/shared build
RUN pnpm --filter @eyewear/backend build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/backend ./apps/backend
WORKDIR /app/apps/backend

EXPOSE 9000
CMD ["pnpm", "start"]
