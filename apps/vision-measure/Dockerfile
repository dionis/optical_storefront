# Self-contained: this service has no dependency on the pnpm workspace or on
# packages/shared, so the build context is this directory itself (unlike
# apps/backend/Dockerfile, which needs the monorepo root).
# Coolify: Base Directory = apps/vision-measure, Dockerfile Location = Dockerfile.

FROM python:3.12-slim AS base
WORKDIR /app

# libgl/libglib are pulled in transitively by rembg's optional onnxruntime image
# preprocessing path; harmless and small if the "tryon" extra is never installed.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Same tool apps/scraper uses locally. The static binary copy is Astral's documented
# pattern for Docker — no extra installer step, no network call at build time beyond
# pulling this one small image.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

COPY pyproject.toml uv.lock ./
# --frozen refuses to silently re-resolve if uv.lock is stale (CI should catch that,
# not paper over it). --no-install-project mirrors [tool.uv] package = false in
# pyproject.toml — vision_api.py resolves its own repo root at runtime (see its
# _REPO_ROOT sys.path insert) and needs no install step for "services" itself.
RUN uv sync --frozen --no-install-project --no-dev

# Uncomment to enable the local (rembg-based) try-on composite in "imageEngine: local":
# RUN uv sync --frozen --no-install-project --no-dev --extra tryon

COPY services services

EXPOSE 8008
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
    CMD curl -f http://localhost:8008/api/health || exit 1

CMD ["uv", "run", "--frozen", "--no-sync", "python", "services/api/vision_api.py"]
