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
