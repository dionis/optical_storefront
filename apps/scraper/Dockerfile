# Catalog scraper worker — its own Coolify app (docs/CATALOG-SYNC.md).
#
# Build context must be the monorepo root: the 4-view step republishes the
# storefront's live media manifest, which reads two files outside this app
# (apps/backend/src/lib/frame-media-pilot.json and
# apps/capri-storefront/public/catalog.json). In Coolify: Base Directory "/",
# Dockerfile Location "apps/scraper/Dockerfile".
#
# The root .dockerignore excludes apps/scraper (it is tuned for the backend), so
# this build uses its own: Dockerfile.dockerignore next to this file (BuildKit).
#
# No port, no domain: the worker polls Medusa, nothing calls it.

FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/srv/venv \
    PATH="/srv/venv/bin:$PATH" \
    SCRAPER_STATE_DB=/data/state.db

WORKDIR /srv/apps/scraper

# Try-on PNGs (rembg + onnxruntime, ~300 MB plus a 175 MB model on first use).
# Off by default: the CX22 runs Medusa, Postgres and Meilisearch beside this,
# and the image pipeline degrades gracefully without it. Build with
# INSTALL_TRYON=1 to enable.
ARG INSTALL_TRYON=0

# Two steps, because apps/scraper is a hatchling package: installing the
# project needs its sources and README.md, which is exactly what made the first
# attempt fail (`OSError: Readme file does not exist`, docs/frame-media-generation.md
# §C.7). Dependencies first — cached across deploys that only touch code.
COPY apps/scraper/pyproject.toml apps/scraper/uv.lock ./
RUN if [ "$INSTALL_TRYON" = "1" ]; then EXTRA="--extra tryon"; else EXTRA=""; fi; \
    uv sync --frozen --no-dev --no-install-project $EXTRA

COPY apps/scraper/README.md apps/scraper/pricing.yaml apps/scraper/__main__.py ./
COPY apps/scraper/scraper ./scraper
RUN if [ "$INSTALL_TRYON" = "1" ]; then EXTRA="--extra tryon"; else EXTRA=""; fi; \
    uv sync --frozen --no-dev $EXTRA

# Read by the media manifest (see the header). Same relative paths as the repo.
COPY apps/backend/src/lib/frame-media-pilot.json /srv/apps/backend/src/lib/frame-media-pilot.json
COPY apps/capri-storefront/public/catalog.json /srv/apps/capri-storefront/public/catalog.json

# The incremental-sync cache. Mount a persistent volume here in Coolify, or
# every redeploy starts empty and the next run re-pushes the whole catalog and
# re-pays its AI translation.
VOLUME ["/data"]

CMD ["python", "-m", "scraper", "worker"]
