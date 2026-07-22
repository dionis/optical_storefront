"""Push scraped products to Medusa via Admin API."""

import json
from typing import Any

import httpx

from scraper.config import Config
from scraper.filler import generate_filler
from scraper.models import ScrapedProduct


def _build_medusa_payload(product: ScrapedProduct, pricing: dict[str, Any]) -> dict[str, Any]:
    """
    Build a Medusa Admin API product upsert payload.
    Prices come from the local pricing.yaml rules, NOT from the supplier.
    """
    # Determine price from pricing rules: collection > default
    collection_rules: dict[str, Any] = pricing.get(product.collection_slug, {})
    price_cents: int = int(
        collection_rules.get("price_cents", pricing.get("default_price_cents", 9900))
    )

    # Deterministic display-only filler (rating/reviews/best-seller/compare-at price).
    # Never used as an input to actual pricing — display metadata only.
    filler = generate_filler(product.handle, price_cents)

    variants: list[dict[str, Any]] = []
    for idx, color in enumerate(product.colors):
        variant: dict[str, Any] = {
            "title": color,
            "sku": product.upc_by_color.get(color, f"{product.handle}-{color.lower().replace(' ', '-')}"),
            "prices": [{"currency_code": "usd", "amount": price_cents}],
            "metadata": {
                "upc": product.upc_by_color.get(color),
                "color": color,
            },
        }
        # Add images for this variant if we have R2 keys
        if idx < len(product.r2_image_keys):
            r2_key = product.r2_image_keys[idx]
            variant["images"] = [{"url": r2_key}]
        variants.append(variant)

    # Primary size for product metadata
    primary_size = product.sizes[0] if product.sizes else None

    return {
        "title": product.model_name,
        "description": product.description_en or None,
        "handle": product.handle,
        "status": "published",
        "variants": variants,
        "images": [
            {"url": key} for key in product.r2_image_keys
        ],
        "thumbnail": product.r2_image_keys[0] if product.r2_image_keys else None,
        "metadata": {
            "eye_size": primary_size.eye_size if primary_size else None,
            "bridge_size": primary_size.bridge_size if primary_size else None,
            "temple_length": primary_size.temple_length if primary_size else None,
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
    payload = _build_medusa_payload(product, pricing)

    if dry_run:
        print(f"[dry-run] Would upsert product: {product.handle}")
        print(json.dumps(payload, indent=2, default=str))
        return None

    headers = {
        "Authorization": f"Bearer {config.medusa_admin_api_key}",
        "Content-Type": "application/json",
    }
    base_url = config.medusa_backend_url.rstrip("/")

    with httpx.Client(timeout=30) as client:
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
