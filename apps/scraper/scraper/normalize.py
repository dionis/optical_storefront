"""Canonicalization helpers ported from the storefront's static sync-catalog.mjs.

Scope (per the "híbrido" decision in docs/scraper-medusa-ingestion-analysis.md):
- Frame MEASUREMENTS are bucketized here (language-neutral strings such as
  "54-56 mm") because Meilisearch/the storefront filter on grouped ranges, and the
  buckets match `apps/capri-storefront/src/data/filters.js` exactly.
- Nominal attribute VALUES (shape/material/gender/age) are NOT translated here; the
  storefront resolves their display language via `tv()`. This module only maps a
  collection slug to a human brand name.
"""

# Collection slug → display brand name. Mirrors the BRAND map in sync-catalog.mjs.
BRAND_NAMES: dict[str, str] = {
    "eyeleos": "Eyeleos",
    "ago": "Ago",
    "artistik-eyewear": "Artistik Eyewear",
    "artistik-galerie": "Artistik Galerie",
    "simply-lite": "Simplylite",
    "di-caprio": "Di Caprio",
    "flexure": "Flexure",
    "grande": "Grande",
    "versailles-palace": "Versailles Palace",
    "trendy": "Trendy",
    "millennial": "Millennial",
    "peachtree": "Peachtree",
    "4u": "Four You",
    "prorx": "ProRx",
    "candy-shoppe": "The Candy Shoppe",
    "slimfold": "Slimfold",
    "case": "Cases",
}


def brand_name(collection_slug: str) -> str:
    """Return the display brand name for a collection slug.

    Falls back to a title-cased version of the slug for brands added at the supplier
    that aren't in the map yet (e.g. "new-brand" → "New Brand").
    """
    if collection_slug in BRAND_NAMES:
        return BRAND_NAMES[collection_slug]
    return " ".join(word.capitalize() for word in collection_slug.split("-"))


def bucket_eye(mm: int | None) -> str | None:
    """Bucket an eye size (mm) into the storefront's canonical ranges."""
    if mm is None:
        return None
    if mm <= 43:
        return "34-43 mm"
    if mm <= 47:
        return "44-47 mm"
    if mm <= 50:
        return "48-50 mm"
    if mm <= 53:
        return "51-53 mm"
    if mm <= 56:
        return "54-56 mm"
    if mm <= 59:
        return "57-59 mm"
    return "Más de 60 mm"


def bucket_bridge(mm: int | None) -> str | None:
    """Bucket a bridge size (mm) into the storefront's canonical ranges."""
    if mm is None:
        return None
    if mm <= 15:
        return "13-15 mm"
    if mm <= 17:
        return "16-17 mm"
    if mm <= 19:
        return "18-19 mm"
    if mm <= 22:
        return "20-22 mm"
    return "23-24 mm"


def bucket_temple(mm: int | None) -> str | None:
    """Bucket a temple length (mm) into the storefront's canonical ranges."""
    if mm is None:
        return None
    if mm <= 120:
        return "115-120 mm"
    if mm <= 130:
        return "125-130 mm"
    if mm <= 140:
        return "135-140 mm"
    if mm <= 150:
        return "145-150 mm"
    return "155+ mm"


def handles_to_unpublish(
    published_handles: set[str], seen_handles: set[str]
) -> set[str]:
    """Handles present in Medusa (published) but absent from the latest sync.

    Pure set difference — the reconciliation step drafts these so discontinued
    models drop off the storefront (self-healing catalog).
    """
    return published_handles - seen_handles
