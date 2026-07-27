"""Main sync orchestrator."""

import asyncio
from typing import Any

import yaml

from scraper.config import Config, get_config
from scraper.http_client import RateLimitedClient
from scraper.images import process_product_images
from scraper.medusa_push import reconcile_discontinued, upsert_product
from scraper.models import ScrapedProduct
from scraper.parser import (
    align_images_to_colors,
    parse_product_html,
    parse_store_api_product,
)
from scraper.state import StateStore
from scraper.translate import translate_product

PRICING_YAML_PATH = "pricing.yaml"
STORE_API_PRODUCTS = "/wp-json/wc/store/v1/products"
STORE_API_CATEGORIES = "/wp-json/wc/store/v1/products/categories"


async def _resolve_category_id(
    client: RateLimitedClient,
    config: Config,
    collection_slug: str,
) -> int | None:
    """
    Resolve a WooCommerce category slug to its numeric ID via the Store API.
    Returns None if not found or if the API is not accessible.
    """
    url = f"{config.base_url}{STORE_API_CATEGORIES}?slug={collection_slug}&per_page=1"
    try:
        resp = await client.get(url)
        if resp.status_code == 304:
            return None
        data: list[dict[str, Any]] = resp.json()
        if data and isinstance(data, list) and data[0].get("id"):
            return int(data[0]["id"])
    except Exception as err:
        print(f"[scraper] Category ID lookup failed for {collection_slug}: {err}")
    return None


async def _fetch_via_store_api(
    client: RateLimitedClient,
    config: Config,
    collection_slug: str,
    category_id: int,
) -> list[ScrapedProduct]:
    """Paginate through the Store API using a numeric category ID."""
    products: list[ScrapedProduct] = []
    page = 1

    while True:
        url = (
            f"{config.base_url}{STORE_API_PRODUCTS}"
            f"?per_page=100&page={page}&category={category_id}"
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
            print(f"[scraper] Store API pagination failed (page {page}): {err}")
            break

    return products


async def _fetch_via_category_html(
    client: RateLimitedClient,
    config: Config,
    collection_slug: str,
) -> list[ScrapedProduct]:
    """
    Fallback: enumerate products from the WooCommerce category HTML page.
    Extracts product links and fetches each product's JSON-LD or API data.
    """
    from bs4 import BeautifulSoup
    import re

    products: list[ScrapedProduct] = []
    page = 1

    while True:
        url = f"{config.base_url}/product-category/{collection_slug}/page/{page}/"
        try:
            resp = await client.get(url)
            if resp.status_code == 304 or resp.status_code == 404:
                break

            soup = BeautifulSoup(resp.text, "lxml")

            # WooCommerce standard product list markup
            product_links = soup.select(
                ".products .product a.woocommerce-loop-product__link, "
                ".products li.product a[href*='/product/']"
            )

            if not product_links:
                break

            # Deduplicate links
            seen: set[str] = set()
            for link in product_links:
                href = link.get("href", "")
                if href and href not in seen:
                    seen.add(str(href))
                    # Fetch individual product page to get structured data
                    try:
                        prod_resp = await client.get(str(href))
                        product = _parse_product_from_html_page(
                            prod_resp.text, str(href), collection_slug
                        )
                        if product:
                            products.append(product)
                    except Exception as prod_err:
                        print(f"[scraper] Failed to fetch product {href}: {prod_err}")

            # Check if there's a next page
            next_link = soup.select_one("a.next.page-numbers")
            if not next_link:
                break
            page += 1

        except Exception as err:
            print(f"[scraper] Category HTML fallback failed (page {page}): {err}")
            break

    return products


def _parse_product_from_html_page(
    html: str,
    url: str,
    collection_slug: str,
) -> "ScrapedProduct | None":
    """Extract a ScrapedProduct from a WooCommerce product HTML page via JSON-LD."""
    import json, re
    from bs4 import BeautifulSoup
    from scraper.parser import parse_product_html
    from scraper.models import ScrapedProduct

    soup = BeautifulSoup(html, "lxml")

    # Try JSON-LD first (most reliable)
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            if isinstance(data, list):
                data = next((d for d in data if d.get("@type") == "Product"), None)
            if data and data.get("@type") == "Product":
                name = data.get("name", "")
                if not name:
                    continue
                slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")
                handle = f"{slug}-{collection_slug}"

                image_urls = []
                for img in data.get("image", []) if isinstance(data.get("image"), list) else [data.get("image", "")]:
                    if isinstance(img, str) and img:
                        image_urls.append(img)
                    elif isinstance(img, dict) and img.get("url"):
                        image_urls.append(img["url"])

                product = ScrapedProduct(
                    model_name=name,
                    handle=handle,
                    collection_slug=collection_slug,
                    image_urls=image_urls,
                )
                # Enrich with HTML attributes
                product = parse_product_html(html, product)
                return product
        except Exception:
            pass

    # Fallback: title tag
    title_el = soup.select_one("h1.product_title, h1.entry-title")
    if title_el:
        name = title_el.get_text(strip=True)
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")
        handle = f"{slug}-{collection_slug}"
        product = ScrapedProduct(
            model_name=name,
            handle=handle,
            collection_slug=collection_slug,
        )
        return parse_product_html(html, product)

    return None


async def _fetch_collection_products(
    client: RateLimitedClient,
    config: Config,
    collection_slug: str,
) -> list[ScrapedProduct]:
    """
    Priority:
    1. Resolve category ID → Store API (structured, fast)
    2. Category HTML page scraping (fallback)
    """
    print(f"[scraper]   Resolving category ID for '{collection_slug}'…")
    category_id = await _resolve_category_id(client, config, collection_slug)

    if category_id is not None:
        print(f"[scraper]   Category ID: {category_id}. Using Store API.")
        products = await _fetch_via_store_api(client, config, collection_slug, category_id)
        if products:
            return products
        print(f"[scraper]   Store API returned 0 products. Trying HTML fallback.")

    print(f"[scraper]   Falling back to category HTML scraping.")
    return await _fetch_via_category_html(client, config, collection_slug)


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
    # Every handle present at the supplier this run, whether pushed or skipped as
    # unchanged. Used to reconcile (draft) discontinued products on full syncs.
    seen_handles: set[str] = set()
    fetch_failed = False

    async with RateLimitedClient(config) as client:
        for collection_slug in target_collections:
            print(f"\n[scraper] ── Syncing collection: {collection_slug} ──")
            products = await _fetch_collection_products(client, config, collection_slug)
            print(f"[scraper]   Found {len(products)} products.")
            if not products:
                # A collection that yields nothing may be a fetch failure, not a real
                # empty — don't let reconciliation unpublish it on a fluke.
                fetch_failed = True

            pushed = 0
            skipped = 0
            for product in products:
                seen_handles.add(product.handle)
                if not full and not state.has_changed(product.handle, product.content_hash):
                    skipped += 1
                    continue

                # Enrich with individual product HTML (for UPC, measurements)
                product = await _enrich_from_html(client, config, product)

                # Align images to colors (token match) so each variant/try-on asset
                # gets its own photo, not a positional guess. Done after enrichment
                # so gallery images pulled from the HTML page are included.
                product.image_urls = align_images_to_colors(
                    product.colors, product.image_urls
                )

                # AI-assisted es/fr translation of title+description (skips gracefully
                # if ANTHROPIC_API_KEY is unset or the call fails — never blocks sync)
                if config.anthropic_api_key:
                    product.translations = (
                        translate_product(product.model_name, product.description_en, config)
                        or {}
                    )

                # Image pipeline (download → optimize → R2 upload)
                product = process_product_images(product, config, dry_run=dry_run)

                # Push to Medusa
                medusa_id = upsert_product(product, config, pricing, dry_run=dry_run)
                if medusa_id or dry_run:
                    pushed += 1
                    if not dry_run:
                        state.mark_seen(product.handle, product.content_hash)

            print(f"[scraper]   Pushed: {pushed}, Skipped (unchanged): {skipped}")

    # Reconcile discontinued models (draft them) — only on a full sync where every
    # collection returned data, so a partial/failed fetch never unpublishes stock.
    if full and not fetch_failed:
        drafted = reconcile_discontinued(
            seen_handles, set(target_collections), config, dry_run=dry_run
        )
        print(f"[scraper]   Reconciled discontinued: {len(drafted)} drafted.")
    elif full and fetch_failed:
        print("[scraper]   Skipping reconciliation — a collection returned no data.")

    print("\n[scraper] ✓ Sync complete.")


async def _enrich_from_html(
    client: RateLimitedClient,
    config: Config,
    product: ScrapedProduct,
) -> ScrapedProduct:
    """Fetch the product HTML page and enrich the product with additional attributes."""
    # Prefer the supplier's own permalink. The fallback strips the collection slug
    # from the handle — `rsplit('-', 1)` is wrong for multi-word slugs like
    # "di-caprio" (us134-di-caprio → us134-di → 404).
    url = product.source_url
    if not url:
        model_slug = product.handle
        suffix = f"-{product.collection_slug}"
        if model_slug.endswith(suffix):
            model_slug = model_slug[: -len(suffix)]
        url = f"{config.base_url}/product/{model_slug}/"
    try:
        resp = await client.get(url)
        if resp.status_code == 304:
            return product
        from scraper.parser import parse_product_html
        product = parse_product_html(resp.text, product)
    except Exception as err:
        print(f"[scraper]   HTML enrichment skipped for {product.handle}: {err}")
    return product
