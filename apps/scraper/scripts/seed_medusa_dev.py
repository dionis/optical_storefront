"""Dev fixture: push a small, renderable product set into Medusa.

NOT the production ingestion path (that's `python -m scraper sync`). This exists so
the storefront's Medusa data layer can be validated against real, complete products
(colors, images, prices) without configuring R2 or running a full live scrape.

It reuses the scraper's own payload builder and upsert so the metadata shape matches
exactly what the real sync produces. Source data is the static catalog the storefront
already ships (`apps/capri-storefront/public/catalog.json`), whose canonical Spanish
attributes are mapped back to the English tokens the scraper contract uses.

Run (from apps/scraper, with the venv):
  MEDUSA_BACKEND_URL=http://localhost:9000 \
  MEDUSA_ADMIN_API_KEY=<secret> \
  MEDUSA_SALES_CHANNEL_ID=<sc_...> \
  PYTHONUTF8=1 python scripts/seed_medusa_dev.py [N_PER_BRAND]
"""

import json
import re
import sys
from pathlib import Path

# Make the `scraper` package importable when run as `python scripts/seed_medusa_dev.py`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.config import get_config
from scraper.images import process_product_images
from scraper.models import FrameSize, ScrapedProduct
from scraper.parser import align_images_to_colors
from scraper.medusa_push import upsert_product

CATALOG = (
    Path(__file__).resolve().parents[2]
    / "capri-storefront"
    / "public"
    / "catalog.json"
)

# Canonical Spanish (static catalog) → English token (scraper contract).
SHAPE_EN = {
    "Cuadrado": "square", "Redondo": "round", "Ojo de gato": "cat-eye",
    "Navegador": "navigator", "Rectángulo": "rectangle", "Aviador": "aviator",
    "Geométrico": "geometric", "Oval": "oval", "Óvalo modificado": "modified-oval",
    "Ronda modificada": "modified-round", "Combo": "combo", "Marco completo": "full-frame",
}
MATERIAL_EN = {
    "Acetato": "acetate", "Plástica": "plastic", "Metal": "metal",
    "Acero inoxidable": "stainless-steel", "Memoria": "memory", "Titanio": "titanium",
    "Inyección": "injection", "TR-90": "tr90", "Ultem": "ultem",
}
GENDER_EN = {"Hombres": "men", "Señoras": "women", "Unisexo": "unisex", "Niños": "kids"}
AGE_EN = {"Adulto": "adult", "Niños": "kids"}


def _bucket_to_mm(bucket: str | None) -> int | None:
    """Representative mm from a bucket string, e.g. '54-56 mm' → 54."""
    if not bucket:
        return None
    m = re.search(r"\d+", bucket)
    return int(m.group()) if m else None


def _to_scraped(entry: dict) -> ScrapedProduct:
    attrs = entry.get("attributes", {})
    colors = [c["name"] for c in entry.get("colors", [])]
    image_urls = [c["image"] for c in entry.get("colors", []) if c.get("image")]
    materials = attrs.get("material") or []
    size = FrameSize(
        eye_size=_bucket_to_mm(attrs.get("eye_size")) or 0,
        bridge_size=_bucket_to_mm(attrs.get("bridge_size")) or 0,
        temple_length=_bucket_to_mm(attrs.get("temple_length")) or 0,
    )
    return ScrapedProduct(
        model_name=entry["name"],
        handle=f"{re.sub(r'[^a-z0-9]+', '-', entry['sku'].lower()).strip('-')}-{entry['brand_slug']}",
        collection_slug=entry["brand_slug"],
        colors=colors,
        image_urls=image_urls,
        sizes=[size],
        material=MATERIAL_EN.get(materials[0], "") if materials else "",
        shape=SHAPE_EN.get(attrs.get("shape", ""), ""),
        gender=GENDER_EN.get(attrs.get("gender", ""), "unisex"),
        age_group=AGE_EN.get(attrs.get("age", ""), "adult"),
        upc_by_color={c["name"]: f"{entry['sku']}-{i}" for i, c in enumerate(entry.get("colors", []))},
    )


def main() -> None:
    n_per_brand = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    config = get_config()
    if not config.medusa_admin_api_key or config.medusa_admin_api_key == "your-medusa-admin-api-key":
        raise SystemExit("MEDUSA_ADMIN_API_KEY (a secret key) is required.")

    entries = json.loads(CATALOG.read_text(encoding="utf-8"))
    pricing = {"default_price_cents": 9900, "di-caprio": {"price_cents": 12900}}

    picked: list[dict] = []
    per_brand: dict[str, int] = {}
    for e in entries:
        b = e.get("brand_slug", "?")
        if per_brand.get(b, 0) >= n_per_brand:
            continue
        if not e.get("colors"):
            continue
        per_brand[b] = per_brand.get(b, 0) + 1
        picked.append(e)

    print(f"[seed] Pushing {len(picked)} products across {len(per_brand)} brands…")
    ok = 0
    for e in picked:
        product = _to_scraped(e)
        product.image_urls = align_images_to_colors(product.colors, product.image_urls)
        product = process_product_images(product, config, dry_run=False)  # R2 unset → hotlink
        try:
            pid = upsert_product(product, config, pricing, dry_run=False)
            ok += 1
            print(f"[seed]   ✓ {product.handle} → {pid}")
        except Exception as err:  # noqa: BLE001 — dev script, report and continue
            print(f"[seed]   ✗ {product.handle}: {err}")

    print(f"[seed] Done. {ok}/{len(picked)} upserted.")


if __name__ == "__main__":
    main()
