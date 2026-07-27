"""Push scraped products to Medusa via Admin API."""

import json
from typing import Any

import httpx

from scraper.config import Config
from scraper.filler import generate_filler
from scraper.models import ScrapedProduct
from scraper.normalize import (
    brand_name,
    bucket_bridge,
    bucket_eye,
    bucket_temple,
    handles_to_unpublish,
)


def _build_medusa_payload(
    product: ScrapedProduct,
    pricing: dict[str, Any],
    sales_channel_id: str | None = None,
) -> dict[str, Any]:
    """
    Build a Medusa Admin API product upsert payload.
    Prices come from the local pricing.yaml rules, NOT from the supplier.

    Out-of-stock products are published as drafts so they drop off the storefront
    and reappear when restocked. When `sales_channel_id` is provided the product is
    associated with it — required for the Store API (publishable key) to return it.
    """
    # Determine price from pricing rules: collection > default
    collection_rules: dict[str, Any] = pricing.get(product.collection_slug, {})
    price_cents: int = int(
        collection_rules.get("price_cents", pricing.get("default_price_cents", 9900))
    )

    # Deterministic display-only filler (rating/reviews/best-seller/compare-at price).
    # Never used as an input to actual pricing — display metadata only.
    filler = generate_filler(product.handle, price_cents)

    # Medusa v2 requires product options; each variant references its option values.
    # Colors are the single variant axis. Products with no parsed color get a single
    # "Default" variant so the product is still purchasable.
    color_names = product.colors or ["Default"]

    variants: list[dict[str, Any]] = []
    for idx, color in enumerate(color_names):
        variant: dict[str, Any] = {
            "title": color,
            "sku": product.upc_by_color.get(color, f"{product.handle}-{color.lower().replace(' ', '-')}"),
            "options": {"Color": color},
            "prices": [{"currency_code": "usd", "amount": price_cents}],
            "metadata": {
                "upc": product.upc_by_color.get(color),
                "color": color,
                # Per-color image (R2 key or hotlinked URL), aligned by index.
                "image": product.r2_image_keys[idx] if idx < len(product.r2_image_keys) else None,
            },
        }
        variants.append(variant)

    # Primary size for product metadata
    primary_size = product.sizes[0] if product.sizes else None

    payload: dict[str, Any] = {
        "title": product.model_name,
        "description": product.description_en or None,
        "handle": product.handle,
        "status": "published" if product.is_in_stock else "draft",
        "options": [{"title": "Color", "values": color_names}],
        "variants": variants,
        "images": [
            {"url": key} for key in product.r2_image_keys
        ],
        "thumbnail": product.r2_image_keys[0] if product.r2_image_keys else None,
        "metadata": {
            # Numeric measurements (kept for Meilisearch numeric facets/sort).
            "eye_size": primary_size.eye_size if primary_size else None,
            "bridge_size": primary_size.bridge_size if primary_size else None,
            "temple_length": primary_size.temple_length if primary_size else None,
            # Bucketed measurements (language-neutral) for the storefront's range
            # filters — see filters.js. Null when the measurement is unknown.
            "eye_size_bucket": bucket_eye(primary_size.eye_size if primary_size else None),
            "bridge_size_bucket": bucket_bridge(primary_size.bridge_size if primary_size else None),
            "temple_length_bucket": bucket_temple(primary_size.temple_length if primary_size else None),
            # Display brand name + slug (storefront shows the pretty name).
            "brand": brand_name(product.collection_slug),
            "brand_slug": product.collection_slug,
            "a": product.a,
            "b": product.b,
            "ed": product.ed,
            "circ": product.circ,
            "material": product.material,
            "shape": product.shape,
            "style": product.style,
            "gender": product.gender,
            "age_group": product.age_group,
            "features": product.features,
            "upc_by_color": product.upc_by_color,
            "collection_slug": product.collection_slug,
            "tryon_keys": product.r2_tryon_keys,
            "rating": filler.rating,
            "review_count": filler.review_count,
            "best_seller": filler.best_seller,
            "original_price_cents": filler.original_price_cents,
            "i18n": product.translations,
        },
    }

    if sales_channel_id:
        payload["sales_channels"] = [{"id": sales_channel_id}]

    return payload


def upsert_product(
    product: ScrapedProduct,
    config: Config,
    pricing: dict[str, Any],
    dry_run: bool = False,
) -> str | None:
    """
    Upsert a product in Medusa by handle.
    Returns the Medusa product ID on success, None on dry-run.
    """
    payload = _build_medusa_payload(
        product, pricing, sales_channel_id=config.medusa_sales_channel_id or None
    )

    if dry_run:
        print(f"[dry-run] Would upsert product: {product.handle}")
        print(json.dumps(payload, indent=2, default=str))
        return None

    # Medusa v2 authenticates secret admin API keys via HTTP Basic (token as the
    # username, empty password) — NOT a Bearer header.
    headers = {"Content-Type": "application/json"}
    auth = (config.medusa_admin_api_key, "")
    base_url = config.medusa_backend_url.rstrip("/")

    with httpx.Client(timeout=30, auth=auth) as client:
        # Check if product already exists
        search_resp = client.get(
            f"{base_url}/admin/products",
            params={"handle": product.handle},
            headers=headers,
        )
        search_resp.raise_for_status()
        products = search_resp.json().get("products", [])

        if products:
            product_id = products[0]["id"]
            resp = client.post(
                f"{base_url}/admin/products/{product_id}",
                json=payload,
                headers=headers,
            )
        else:
            resp = client.post(
                f"{base_url}/admin/products",
                json=payload,
                headers=headers,
            )

        resp.raise_for_status()
        return str(resp.json().get("product", {}).get("id", ""))


def _list_published_handles(
    client: httpx.Client,
    base_url: str,
    headers: dict[str, str],
    target_collections: set[str],
) -> dict[str, str]:
    """Return {handle: product_id} for published products we manage.

    Scoped to our collections via metadata.collection_slug so reconciliation never
    touches products created outside this scraper.
    """
    managed: dict[str, str] = {}
    offset, limit = 0, 100
    while True:
        resp = client.get(
            f"{base_url}/admin/products",
            params={"status[]": "published", "limit": limit, "offset": offset},
            headers=headers,
        )
        resp.raise_for_status()
        body = resp.json()
        products = body.get("products", [])
        for p in products:
            collection_slug = (p.get("metadata") or {}).get("collection_slug")
            if collection_slug in target_collections and p.get("handle"):
                managed[p["handle"]] = p["id"]
        count = body.get("count", len(products))
        offset += limit
        if offset >= count or not products:
            break
    return managed


def reconcile_discontinued(
    seen_handles: set[str],
    target_collections: set[str],
    config: Config,
    dry_run: bool = False,
) -> list[str]:
    """Draft published products whose handle no longer appears at the supplier.

    Self-healing catalog: on a full sync, any managed product missing from this
    run's `seen_handles` is set to `status: "draft"` so it drops off the storefront.
    Returns the list of handles drafted. Refuses to run on an empty `seen_handles`
    (a failed fetch must never unpublish the whole catalog).
    """
    if not seen_handles:
        print("[reconcile] SKIP — 0 handles seen this run (refusing to unpublish).")
        return []

    headers = {"Content-Type": "application/json"}
    auth = (config.medusa_admin_api_key, "")
    base_url = config.medusa_backend_url.rstrip("/")

    with httpx.Client(timeout=30, auth=auth) as client:
        managed = _list_published_handles(client, base_url, headers, target_collections)
        stale = handles_to_unpublish(set(managed.keys()), seen_handles)

        for handle in sorted(stale):
            if dry_run:
                print(f"[dry-run] Would draft discontinued product: {handle}")
                continue
            resp = client.post(
                f"{base_url}/admin/products/{managed[handle]}",
                json={"status": "draft"},
                headers=headers,
            )
            resp.raise_for_status()
            print(f"[reconcile] Drafted discontinued: {handle}")

    return sorted(stale)
