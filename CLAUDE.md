# Eyewear Store — CLAUDE.md

## Project overview

Online store for prescription eyeglasses. Catalog ingested via scraping from caprioptics.com (WooCommerce B2B supplier). Lens-selection funnel mirrors Zeelool. Includes virtual try-on and AI prescription OCR.

## Monorepo structure

```
eyewear-store/
├── apps/
│   ├── backend/       # Medusa.js v2, Node 20, TypeScript strict
│   ├── storefront/    # Next.js 15 App Router, Tailwind, shadcn/ui
│   └── scraper/       # Python 3.12 catalog ingestion
├── packages/
│   └── shared/        # Shared TS types: Prescription, LensConfig, FrameAttributes
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── github-actions/
└── CLAUDE.md
```

## Development phases

1. **Scaffold** — monorepo, docker-compose, Medusa boots, Next.js boots, shared types, CI skeleton ✅
2. **Catalog** — scraper MVP, Meilisearch indexing, listing page with filters
3. **Product & funnel** — PDP, lens-config module, 4-step wizard, dynamic pricing, cart
4. **Prescription OCR** — upload endpoint, Anthropic vision, prefill+confirm UX
5. **Payments** — Stripe → PayPal → Square custom provider
6. **Try-on** — rembg pipeline, MediaPipe overlay
7. **Production** — prod compose, Coolify deploy, backups, full scraper, smoke tests

## Key conventions

- Conventional commits; one phase = one or more focused commits
- TypeScript strict mode everywhere
- All code, comments, identifiers in English; UI copy in Spanish (es)
- Never trust client-side totals — price always computed server-side
- Prescriptions are health data: R2 prescription bucket is private, presigned URLs only
- Never commit credentials; all secrets via env vars
- Check `node_modules` package types before inventing Medusa v2 API signatures
- Tests: unit tests for prescription validation + pricing, integration tests for scraper parser (no live HTTP in CI)

## Commands

```bash
# Start all services
pnpm dev

# Lint / typecheck
pnpm lint
pnpm typecheck

# Tests
pnpm test

# Full Meilisearch reindex
pnpm reindex

# Scraper
cd apps/scraper
python -m scraper sync [--full] [--collection SLUG] [--dry-run]
```

## Environment variables

See `.env.example` in each app.

## Infrastructure budget

Target: single Hetzner CX22 VPS (~€4/mo) managed by Coolify. Total infra < $75/month.
