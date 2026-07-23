# Cloud-portable catalog sync service.
# Build:  docker build -f scripts/Dockerfile -t oer-catalog-sync .
# Run:    docker run --rm -e CATALOG_SOURCE=https://caprioptics.com \
#                 -e CATALOG_OUT_DIR=/out -v $PWD/public:/out oer-catalog-sync
#
# One-shot job — point any cloud scheduler at it (Cloud Run Jobs, ECS Scheduled
# Task, Kubernetes CronJob, Azure Container Apps job, etc.). No dependencies, no
# build step: it only needs Node + network access to the source store's API.
FROM node:20-alpine
WORKDIR /app
COPY scripts/sync-catalog.mjs ./scripts/sync-catalog.mjs
ENV CATALOG_OUT_DIR=/out
VOLUME ["/out"]
ENTRYPOINT ["node", "scripts/sync-catalog.mjs"]
