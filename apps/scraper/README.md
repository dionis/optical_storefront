# Eyewear Scraper

Catalog ingestion service for the eyewear store. Scrapes product data from caprioptics.com, processes images, and pushes to Medusa + Meilisearch.

## Usage

```bash
# Install
pip install -e ".[dev]"

# Sync all collections (incremental by default)
python -m scraper sync

# Full re-sync (ignores state cache)
python -m scraper sync --full

# Single collection
python -m scraper sync --collection di-caprio

# Dry run (no writes to Medusa or R2)
python -m scraper sync --dry-run
```

Every sync ends with a summary (new / updated / unchanged / failed / retired, and
the new models by handle).

## In production: the worker (monthly + on demand)

```bash
python -m scraper worker          # poll Medusa every minute, run what is queued
python -m scraper worker --once   # one poll, then exit
```

The worker runs as its own Coolify app (`Dockerfile` here, build context = repo
root). It never decides when to scrape: the backend queues a run once a month and
the owner can queue one from `/admin` → Catálogo → Sincronización, where progress,
«Detener» and the result of each run (with the new models) are shown. New models
also get their 4 views generated, within the per-run cap the owner sets.
Setup and design: [`docs/CATALOG-SYNC.md`](../../docs/CATALOG-SYNC.md).

## Configuration

Copy `.env.example` to `.env` and fill in your credentials.

## Tests

```bash
pytest tests/ -v
```

Tests run against saved HTML fixtures (`tests/fixtures/`) — no live HTTP requests in CI.

## Generated frame media (4 views · promo video)

`python -m scraper media …` generates product packshots and promotional video
through Gemini, and stores them the same way the image pipeline stores supplier
photos. It spends money per request and is never scheduled: it runs by hand.

**Operating guide:** [`scraper/media/README.md`](scraper/media/README.md) — how to
set up a remote machine, run the first views and video, and read the failures.

**Design and rationale:** [`docs/frame-media-generation.md`](../../docs/frame-media-generation.md).
