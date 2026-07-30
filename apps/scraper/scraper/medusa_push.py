"""Push scraped products to Medusa via Admin API."""

import atexit
import json
from typing import Any

import httpx
from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

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

# One pooled client for the whole run. A fresh `httpx.Client` per product meant a
# full TLS handshake per product against the Medusa host — over a second each on a
# remote (Coolify/sslip.io) deployment — and a single dropped handshake surfaced as
# `SSL: UNEXPECTED_EOF_WHILE_READING`, aborting the sync mid-catalog. Keep-alive
# collapses that to one connection, so there is far less to go wrong per run.
_client: httpx.Client | None = None


def _admin_client(config: Config) -> httpx.Client:
    """Return the pooled admin client, creating it on first use."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.Client(
            # Medusa v2 authenticates secret admin API keys via HTTP Basic (token as
            # the username, empty password) — NOT a Bearer header.
            auth=(config.medusa_admin_api_key, ""),
            headers={"Content-Type": "application/json"},
            timeout=httpx.Timeout(30.0, connect=15.0),
            # Transport-level replay of connect failures, beneath the tenacity retry
            # below; the two together survive a host that drops handshakes.
            transport=httpx.HTTPTransport(retries=3),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=4),
        )
    return _client


def close_admin_client() -> None:
    """Close the pooled admin client. Idempotent."""
    global _client
    if _client is not None and not _client.is_closed:
        _client.close()
    _client = None


atexit.register(close_admin_client)


def _log_retry(state: RetryCallState) -> None:
    err = state.outcome.exception() if state.outcome else None
    sleep = getattr(state.next_action, "sleep", 0.0)
    label = str(err) if isinstance(err, _GatewayError) else type(err).__name__
    print(
        f"[medusa] transient {label} on attempt "
        f"{state.attempt_number}/4 — retrying in {sleep:.0f}s"
    )


# Safe to replay on any method: a connect-phase failure means the request never
# reached Medusa, so a retry cannot duplicate a product.
_CONNECT_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout)
# Reads are idempotent, so a failure mid-flight is safe to replay as well. Writes
# deliberately do NOT retry these — Medusa may have already applied the change.
_READ_ERRORS = _CONNECT_ERRORS + (
    httpx.ReadError,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
)

# Statuses the reverse proxy — not Medusa — produces when it cannot get a timely
# answer from the backend container. On a small VPS a long sync makes the Node
# process stall past the proxy's patience, and the run would die mid-catalog on
# what is really a hiccup. These say nothing about the request's validity, so a
# read is safe to replay; every other 4xx/5xx is a real answer and still surfaces
# immediately.
_GATEWAY_STATUSES = frozenset({502, 503, 504})


class _GatewayError(Exception):
    """Carries a gateway response through tenacity so the retry can see it."""

    def __init__(self, response: httpx.Response) -> None:
        super().__init__(f"HTTP {response.status_code} from the gateway")
        self.response = response


@retry(
    retry=retry_if_exception_type(_READ_ERRORS + (_GatewayError,)),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    before_sleep=_log_retry,
    reraise=True,
)
def _get_with_retry(client: httpx.Client, url: str, **kwargs: Any) -> httpx.Response:
    response = client.get(url, **kwargs)
    if response.status_code in _GATEWAY_STATUSES:
        raise _GatewayError(response)
    return response


def _get(client: httpx.Client, url: str, **kwargs: Any) -> httpx.Response:
    """GET an admin endpoint, retried on transport flakiness and gateway errors.

    Mirrors the policy the supplier-facing client already has
    (`http_client.RateLimitedClient.get`). An HTTP error status is a real
    rejection and must surface immediately — except the gateway statuses above,
    which mean the request never got a verdict from Medusa at all.
    """
    try:
        return _get_with_retry(client, url, **kwargs)
    except _GatewayError as exc:
        # Retries exhausted. Hand the response back untouched so the caller's
        # `raise_for_status()` reports it as the HTTP error it has always been.
        return exc.response


@retry(
    retry=retry_if_exception_type(_CONNECT_ERRORS),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    before_sleep=_log_retry,
    reraise=True,
)
def _post(client: httpx.Client, url: str, **kwargs: Any) -> httpx.Response:
    """POST to an admin endpoint, retried only when the request never left."""
    return client.post(url, **kwargs)


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
    # Determine price from pricing rules: collection > default. pricing.yaml is
    # authored in cents; Medusa v2 stores prices as DECIMAL major units (dollars,
    # e.g. 99.00 — NOT cents), so convert here for the variant price amount.
    collection_rules: dict[str, Any] = pricing.get(product.collection_slug, {})
    price_cents: int = int(
        collection_rules.get("price_cents", pricing.get("default_price_cents", 9900))
    )
    price_amount = round(price_cents / 100, 2)

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
            # Frames are made/ordered per sale (availability comes from the scraper's
            # is_in_stock gate, not Medusa inventory), so don't stock-track variants.
            "manage_inventory": False,
            "prices": [{"currency_code": "usd", "amount": price_amount}],
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


def _as_update_payload(
    payload: dict[str, Any],
    existing: dict[str, Any],
) -> dict[str, Any]:
    """Adapt a create payload for `POST /admin/products/:id`.

    Two things differ from create, both verified against the installed
    `@medusajs/medusa` (2.17.2) request validators:

    1. Medusa 2.16.0 REMOVED the product-level `options` property from the update
       schema. It is not merely ignored — the validator rejects the whole request
       with "The 'options' property was removed in version 2.16.0". `CreateProduct`
       still accepts it, so only the update payload may drop it. Options are
       managed through the dedicated `/admin/products/:id/options` routes now; we
       never change the colour axis on an update, so there is nothing to send.

    2. `id` is OPTIONAL on an update variant, which means a variant sent without
       one is CREATED rather than matched — silently duplicating every colour on
       each sync. Match the existing rows by SKU (falling back to title, since the
       colour name is what the SKU is derived from) and carry their ids over.
    """
    update = {key: value for key, value in payload.items() if key != "options"}

    existing_variants = existing.get("variants") or []
    by_sku = {v["sku"]: v["id"] for v in existing_variants if v.get("sku") and v.get("id")}
    by_title = {v["title"]: v["id"] for v in existing_variants if v.get("title") and v.get("id")}

    variants = []
    for variant in update.get("variants") or []:
        variant_id = by_sku.get(variant.get("sku")) or by_title.get(variant.get("title"))
        variants.append({**variant, "id": variant_id} if variant_id else variant)
    if variants:
        update["variants"] = variants

    return update


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

    base_url = config.medusa_backend_url.rstrip("/")
    client = _admin_client(config)

    # Check if product already exists
    search_resp = _get(
        client,
        f"{base_url}/admin/products",
        # Variants are needed to carry their ids into the update payload, and
        # they are not part of the default field set.
        params={"handle": product.handle, "fields": "id,handle,*variants"},
    )
    search_resp.raise_for_status()
    products = search_resp.json().get("products", [])

    if products:
        existing = products[0]
        resp = _post(
            client,
            f"{base_url}/admin/products/{existing['id']}",
            json=_as_update_payload(payload, existing),
        )
    else:
        resp = _post(client, f"{base_url}/admin/products", json=payload)

    # `raise_for_status()` reports only the status line, but Medusa puts the
    # useful part — which field it rejected and why — in the response body.
    # Without this a validation slip surfaces as a bare "400 Bad Request"
    # against an opaque product id.
    if resp.is_error:
        raise RuntimeError(
            f"Medusa rejected {'update' if products else 'create'} of "
            f"{product.handle!r} with HTTP {resp.status_code}: {resp.text[:800]}"
        )
    return str(resp.json().get("product", {}).get("id", ""))


def _list_published_handles(
    client: httpx.Client,
    base_url: str,
    target_collections: set[str],
) -> dict[str, str]:
    """Return {handle: product_id} for published products we manage.

    Scoped to our collections via metadata.collection_slug so reconciliation never
    touches products created outside this scraper.
    """
    managed: dict[str, str] = {}
    offset, limit = 0, 100
    while True:
        resp = _get(
            client,
            f"{base_url}/admin/products",
            params={"status[]": "published", "limit": limit, "offset": offset},
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

    base_url = config.medusa_backend_url.rstrip("/")
    client = _admin_client(config)

    managed = _list_published_handles(client, base_url, target_collections)
    stale = handles_to_unpublish(set(managed.keys()), seen_handles)

    for handle in sorted(stale):
        if dry_run:
            print(f"[dry-run] Would draft discontinued product: {handle}")
            continue
        resp = _post(
            client,
            f"{base_url}/admin/products/{managed[handle]}",
            json={"status": "draft"},
        )
        resp.raise_for_status()
        print(f"[reconcile] Drafted discontinued: {handle}")

    return sorted(stale)
