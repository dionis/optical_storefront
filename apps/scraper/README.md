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
