"""Main sync orchestrator."""

import asyncio
from typing import Any

import yaml

from scraper.config import Config, get_config
from scraper.http_client import RateLimitedClient
from scraper.images import process_product_images
from scraper.medusa_push import upsert_product
from scraper.models import ScrapedProduct
from scraper.parser import parse_product_html, parse_store_api_product
from scraper.state import StateStore

PRICING_YAML_PATH = "pricing.yaml"
STORE_API_BASE = "/wp-json/wc/store/v1/products"


async def _fetch_collection_via_store_api(
    client: RateLimitedClient,
    config: Config,
    collection_slug: str,
) -> list[ScrapedProduct]:
    """Try the WooCommerce Store API first; fall back to HTML scraping."""
    products: list[ScrapedProduct] = []
    page = 1

    while True:
        url = (
            f"{config.base_url}{STORE_API_BASE}"
            f"?per_page=100&page={page}&category={collection_slug}"
        )
        try:
            resp = await client.get(url)
            if resp.status_code == 304:
                break
            data: list[dict[str, Any]] = resp.json()
            if not data:
                break
            for item in data:
                products.append(parse_store_api_product(item, collection_slug))
            if len(data) < 100:
                break
            page += 1
        except Exception as err:
            print(f"[scraper] Store API failed for {collection_slug} (page {page}): {err}")
            break

    return products


async def _enrich_from_html(
    client: RateLimitedClient,
    config: Config,
    product: ScrapedProduct,
) -> ScrapedProduct:
    """Fetch the product HTML page and enrich the product with additional attributes."""
    url = f"{config.base_url}/product/{product.handle}/"
    try:
        resp = await client.get(url)
        if resp.status_code == 304:
            return product
        product = parse_product_html(resp.text, product)
    except Exception as err:
        print(f"[scraper] HTML enrichment failed for {product.handle}: {err}")
    return product


def _load_pricing() -> dict[str, Any]:
    try:
        with open(PRICING_YAML_PATH) as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        print(f"[scraper] {PRICING_YAML_PATH} not found — using default pricing.")
        return {"default_price_cents": 9900}


async def sync(
    config: Config,
    collections: list[str] | None = None,
    full: bool = False,
    dry_run: bool = False,
) -> None:
    state = StateStore(config.state_db_path)
    pricing = _load_pricing()
    target_collections = collections or config.collections

    async with RateLimitedClient(config) as client:
        for collection_slug in target_collections:
            print(f"[scraper] Syncing collection: {collection_slug}")
            products = await _fetch_collection_via_store_api(client, config, collection_slug)
            print(f"[scraper]   Found {len(products)} products via Store API.")

            for product in products:
                if not full and not state.has_changed(product.handle, product.content_hash):
                    print(f"[scraper]   Skipping unchanged: {product.handle}")
                    continue

                # Enrich with HTML where Store API is missing data
                product = await _enrich_from_html(client, config, product)

                # Image pipeline
                product = process_product_images(product, config, dry_run=dry_run)

                # Push to Medusa
                medusa_id = upsert_product(product, config, pricing, dry_run=dry_run)
                if medusa_id:
                    print(f"[scraper]   Upserted: {product.handle} → {medusa_id}")

                if not dry_run:
                    state.mark_seen(product.handle, product.content_hash)

    print("[scraper] Sync complete.")
