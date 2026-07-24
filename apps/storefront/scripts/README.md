# Catalog sync service (cloud)

Daily service that keeps the storefront catalog current from the caprioptics
WooCommerce **Store API**. It is a **cloud service**, not a local task:

- Keeps only **available** frames/cases (`is_in_stock === true`) — sold-out / removed
  models disappear automatically.
- **Adds new models of any brand** automatically (brand = product category).
- Normalizes attributes to Spanish + filter size-buckets; reuses known per-color
  images and only fetches the gallery for brand-new models.
- Writes `public/catalog.json`, `public/cases.json`, `public/catalog-meta.json`.
  On API failure it **keeps the last good catalog** (never publishes an empty one).

The storefront (SPA) reads those JSON files at runtime via `src/data/catalogStore.js`,
so the catalog refreshes **without rebuilding**. For SaaS, set `VITE_CATALOG_URL`
to the hosted catalog base so the client reads the cloud copy directly.

## Run locally / manually
```bash
node scripts/sync-catalog.mjs
```

## Environment
| Var | Default | Purpose |
|-----|---------|---------|
| `CATALOG_SOURCE`  | `https://caprioptics.com` | Source WooCommerce site (multi-tenant SaaS ready) |
| `CATALOG_OUT_DIR` | `../public` | Where to write the JSON (mount a volume / build dir in cloud) |

## Cloud deployment options
1. **GitHub Actions** (included): `.github/workflows/catalog-sync.yml` runs daily
   (08:00 UTC) on GitHub's cloud and commits the regenerated catalog. Zero infra.
2. **Container** (included `scripts/Dockerfile`): a one-shot job for Cloud Run Jobs,
   ECS Scheduled Tasks, Kubernetes `CronJob`, Azure Container Apps jobs, etc.
   ```bash
   docker build -f scripts/Dockerfile -t oer-catalog-sync .
   docker run --rm -e CATALOG_OUT_DIR=/out -v "$PWD/public:/out" oer-catalog-sync
   ```
3. **Any serverless cron** (Vercel Cron, Cloudflare Workers Cron, Lambda + EventBridge):
   invoke `sync-catalog.mjs` on a schedule and publish the JSON to your CDN/bucket,
   then point `VITE_CATALOG_URL` at it.
