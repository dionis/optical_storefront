# Eyewear Store

Online store for prescription eyeglasses. The catalog is ingested by scraping a
WooCommerce B2B supplier (caprioptics.com), and the purchase flow mirrors
Zeelool-style lens configuration: pick frames, choose lens type/coatings,
upload or OCR a prescription, preview with virtual try-on, and check out with
Stripe, PayPal, or Square.

## Objective

Provide a small, self-hostable e-commerce platform, purpose-built for
prescription eyewear, that a single operator can run on a budget VPS
(target: **< $75/month** total infra). It exists to solve problems generic
storefronts don't handle out of the box:

- Turning a supplier's raw catalog into sellable products via an automated
  scraper + search index.
- A guided, multi-step lens-selection funnel with server-computed dynamic
  pricing (client-submitted totals are never trusted).
- Capturing and validating prescriptions — including AI-assisted OCR — while
  treating them as protected health information (private storage, presigned
  URLs, audit logging, GDPR/CCPA deletion).
- Letting customers preview frames on their own face (virtual try-on) before
  buying.

## Monorepo structure

```
eyewear-store/
├── apps/
│   ├── backend/           # Medusa.js v2, Node 20, TypeScript strict
│   ├── storefront/        # React + Vite storefront (mirror of capri-storefront, port 3000)
│   ├── capri-storefront/  # React + Vite storefront (own catalog sync, admin dashboard)
│   └── scraper/           # Python 3.12 catalog ingestion
├── packages/
│   └── shared/        # Shared TS types: Prescription, LensConfig, FrameAttributes
├── infra/
│   ├── docker-compose.yml       # local dev dependencies
│   ├── docker-compose.prod.yml  # production stack (Coolify/Hetzner)
│   └── github-actions/
└── CLAUDE.md
```

## Prerequisites

- Node.js ≥ 20, pnpm ≥ 9
- Python 3.12 (for the scraper)
- Docker (for local Postgres, Redis, Meilisearch, and a MinIO stand-in for R2)

## Getting started

1. **Install JS dependencies** (from the repo root):

   ```bash
   pnpm install
   ```

2. **Start local infrastructure** (Postgres, Redis, Meilisearch, MinIO):

   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```

3. **Configure environment variables.** Copy each app's example file and fill
   in real values (see [External resources per component](#external-resources-per-component) below):

   ```bash
   cp apps/backend/.env.example apps/backend/.env
   cp apps/scraper/.env.example apps/scraper/.env
   ```

4. **Run database migrations and seed data** (backend):

   ```bash
   pnpm --filter backend exec medusa db:migrate
   pnpm --filter backend seed
   ```

5. **Create the Meilisearch indexes**, then populate them by running the
   scraper at least once (steps 6–7).

   ```bash
   pnpm --filter backend setup-search
   ```

6. **Run the scraper** to populate the catalog:

   ```bash
   cd apps/scraper
   pip install -e ".[dev]"
   python -m scraper sync --dry-run   # verify parsing without writing
   python -m scraper sync             # ingest into Medusa + R2/MinIO
   ```

7. **Start the apps** (backend + storefront, in parallel):

   ```bash
   pnpm dev
   ```

   Or individually:

   ```bash
   pnpm --filter backend dev      # Medusa admin/API on :9000
   pnpm --filter storefront dev   # Next.js storefront on :3000
   ```

8. **Reindex Meilisearch** any time the catalog changes without going through
   the scraper:

   ```bash
   pnpm reindex
   ```

### Other commands

```bash
pnpm lint            # lint all workspaces
pnpm typecheck        # typecheck all workspaces
pnpm test             # run all tests
cd apps/scraper && pytest tests/ -v   # scraper tests (HTML fixtures, no live HTTP)
```

## External resources per component

Nothing above will run in a meaningfully "complete" way — payments, prescription
uploads, OCR, transactional email, search — without provisioning the external
accounts below. Everything is configured exclusively through environment
variables (see each app's `.env.example`); no secrets are ever committed.

### `apps/backend` (Medusa)

| Resource | Purpose | Required for |
|---|---|---|
| **PostgreSQL** | Primary datastore | Always (local Docker container is fine for dev) |
| **Redis** | Medusa event bus / workflow engine cache | Always |
| **Cloudflare R2** (S3-compatible) | Product image storage + private prescription bucket | Product images, prescription upload/OCR, backups |
| **Meilisearch** | Product search index | Catalog listing/search |
| **Stripe** account + API keys | Card payments | Checkout (Stripe path) |
| **PayPal** developer app (client id/secret, webhook id) | PayPal payments | Checkout (PayPal path) |
| **Square** developer app (access token, location id, webhook signature key) | Square payments | Checkout (Square path) |
| **Anthropic API key** | Vision-based prescription OCR | Prescription auto-fill from photo upload |
| **Resend** account + API key | Transactional email (order confirmations, etc.) | Order/notification emails |

In production (`infra/docker-compose.prod.yml`), these are supplied as
Coolify-managed environment variables and the container talks to the
`postgres`, `redis`, and `meilisearch` services over the internal Docker
network — only R2, Stripe, PayPal, Square, Anthropic, and Resend are truly
*external* services that must be provisioned outside the VPS.

### `apps/storefront` (Next.js)

| Resource | Purpose | Required for |
|---|---|---|
| **Backend URL + Medusa publishable API key** | Talk to the Medusa Store API | Always |
| **Meilisearch host + public search-only key** | Client-side catalog search/filters | Catalog listing page |
| **Cloudflare R2 / CDN public URL** | Serving product & try-on images | Product images, try-on |
| **Stripe publishable key** | Stripe Elements checkout UI | Checkout (Stripe path) |
| **PayPal client id** | PayPal button SDK | Checkout (PayPal path) |
| **Square app id + location id** | Square Web Payments SDK | Checkout (Square path) |
| **Public site URL** (`NEXT_PUBLIC_SITE_URL`) | SEO metadata (`metadataBase`, Open Graph) | Production builds |

Only *publishable*/public keys ever live in the storefront — secret keys stay
on the backend.

### `apps/scraper` (Python)

| Resource | Purpose | Required for |
|---|---|---|
| **Medusa backend URL + admin API key** | Push scraped products into Medusa | Always |
| **Cloudflare R2** | Upload processed product images | Always |
| **Meilisearch host + master key** | Trigger reindex after ingest | Post-sync search reindex |
| Target site reachability (caprioptics.com) | Actual scraping | Live `sync` runs (not needed for tests, which use fixtures) |

### Infra / deployment

The backend is deployed to an **Oracle Cloud Free Tier** VM (Ampere/ARM,
reserved public IP) via **Coolify**, a self-hosted PaaS running on that same
VM. Only the backend runs there — Postgres is a managed **Supabase** free-tier
project (Session Pooler connection, not Direct or Transaction Pooler — see the
doc below for why), and Redis/Meilisearch run as lightweight Coolify services
on the VM. The storefront is deployed separately on **Vercel**.

Full setup notes — Oracle networking gotchas, Coolify configuration, the
backend `Dockerfile`, environment variables, and the pending production
checklist (custom domain, live payment keys, etc.) — are documented in
[docs/deploy-backend-coolify-oracle.md](docs/deploy-backend-coolify-oracle.md).

`infra/docker-compose.prod.yml` (a fully self-hosted stack — Postgres, Redis,
Meilisearch, backend, and storefront all on one VPS, as originally planned
for a Hetzner CX22) still exists and works, but is **not** what's currently
deployed; treat it as a legacy/alternative path.

## Prescription data handling

Prescriptions are treated as protected health information: the R2 bucket that
stores them is private, accessed only via short-lived (15 min) presigned
URLs, all admin reads are audit-logged, and a GDPR/CCPA-compliant deletion
endpoint is provided. See [SECURITY.md](SECURITY.md) for details.

## Development phases

1. Scaffold — monorepo, docker-compose, Medusa boots, Next.js boots, shared types, CI skeleton ✅
2. Catalog — scraper MVP, Meilisearch indexing, listing page with filters ✅
3. Product & funnel — PDP, lens-config module, 4-step wizard, dynamic pricing, cart ✅
4. Prescription OCR — upload endpoint, Anthropic vision, prefill+confirm UX ✅
5. Payments — Stripe → PayPal → Square custom provider ✅
6. Try-on — rembg pipeline, MediaPipe overlay ✅
7. Production — prod compose, Coolify deploy, backups, full scraper, smoke tests

See [CLAUDE.md](CLAUDE.md) for full conventions and contributor guidelines.
