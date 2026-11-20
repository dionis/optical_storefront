"""Push scraped products to Medusa via Admin API."""

import atexit
import json
from dataclasses import dataclass
from datetime import UTC, datetime
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
            # Products take ~30-75s each once the image pipeline runs, so a pooled
            # connection sits idle far longer than any NAT or proxy keeps its state.
            # Reusing one the far side has silently dropped surfaces as a corrupt
            # record (`SSLV3_ALERT_BAD_RECORD_MAC`) or a bare ReadError. Expiring
            # idle connections well inside that window costs one handshake per
            # product and removes the whole failure mode.
            limits=httpx.Limits(
                max_connections=4,
                max_keepalive_connections=4,
                keepalive_expiry=20.0,
            ),
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


def report_ai_usage(config: Config, events: list[dict[str, Any]]) -> bool:
    """Send AI usage events to the backend's «Consumo IA» (`POST /admin/ai-usage/ingest`).

    Best-effort: a backend that does not have the route yet (404), a network
    error or a rejected event never interrupts the sync — it is logged and
    dropped. Returns whether the backend accepted the batch.
    """
    if not events or not config.medusa_admin_api_key:
        return False
    base_url = config.medusa_backend_url.rstrip("/")
    try:
        resp = _post(
            _admin_client(config),
            f"{base_url}/admin/ai-usage/ingest",
            json={"events": events[:200]},
        )
        if resp.status_code >= 400:
            print(f"[scraper] AI usage report refused ({resp.status_code}) — not counted.")
            return False
        return True
    except Exception as err:  # noqa: BLE001 — tracking must not stop a sync
        print(f"[scraper] AI usage report failed: {type(err).__name__}: {err}")
        return False


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

    What differs from create, all verified against the installed
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

    3. Medusa REPLACES `metadata` on update (2.17.2 has no merge). Sending only
       the scraper's keys used to erase every key somebody else wrote: the
       product's `first_seen_at`, and on variants the generated `views`/`video`
       that `media sync` copies there. Existing keys are kept and ours win, so
       the scraper still owns its own fields and nothing else.

    4. A variant's `options` must name a value the product's «Color» option
       already has, or Medusa rejects the WHOLE update ("Option value Black does
       not exist for option Color") — and since options cannot be sent here, the
       product never heals. A matched variant keeps its colour, so it sends no
       `options` at all. A new colour reuses the product's own spelling when one
       differs only in case ("BROWN" vs "Brown"), and `upsert_product` links
       every new colour to the product first (`_new_variant_colors`).
    """
    update = {key: value for key, value in payload.items() if key != "options"}

    update["metadata"] = {
        **(existing.get("metadata") or {}),
        **(payload.get("metadata") or {}),
    }

    existing_variants = existing.get("variants") or []
    by_sku = {v["sku"]: v["id"] for v in existing_variants if v.get("sku") and v.get("id")}
    # Case-insensitive: a product created as "BROWN" must not grow a "Brown" twin.
    by_title = {
        v["title"].casefold(): v["id"] for v in existing_variants if v.get("title") and v.get("id")
    }
    metadata_by_id = {v["id"]: v.get("metadata") or {} for v in existing_variants if v.get("id")}
    color_spelling = {value.casefold(): value for value in _color_values(existing)}

    variants = []
    for variant in update.get("variants") or []:
        variant_id = by_sku.get(variant.get("sku")) or by_title.get(
            str(variant.get("title") or "").casefold()
        )
        if variant_id:
            variant = {
                key: value for key, value in variant.items() if key != "options"
            } | {
                "id": variant_id,
                "metadata": {
                    **metadata_by_id.get(variant_id, {}),
                    **(variant.get("metadata") or {}),
                },
            }
        elif variant.get("options"):
            color = str(variant["options"].get(COLOR_OPTION, ""))
            variant = {
                **variant,
                "options": {COLOR_OPTION: color_spelling.get(color.casefold(), color)},
            }
        variants.append(variant)
    if variants:
        update["variants"] = variants

    return update


#: The single variant axis the scraper creates (see `_build_medusa_payload`).
COLOR_OPTION = "Color"


def _color_option(existing: dict[str, Any]) -> dict[str, Any] | None:
    """The product's «Color» option as Medusa returned it, if it has one."""
    for option in existing.get("options") or []:
        if str(option.get("title") or "").casefold() == COLOR_OPTION.casefold():
            return option
    return None


def _color_values(existing: dict[str, Any]) -> list[str]:
    option = _color_option(existing)
    return [
        str(v["value"]) for v in (option or {}).get("values") or [] if v.get("value")
    ]


def _new_variant_colors(update: dict[str, Any]) -> list[str]:
    """Colours of the variants this update CREATES (those without an `id`).

    All of them, not only the ones missing from `existing["options"]`: since
    2.17 an option is shared between products and lists every value any
    product uses, while a variant may only name a value linked to ITS product.
    Linking is idempotent (Medusa skips a value already linked), so linking
    them all is the one check that cannot be fooled by a shared option.
    """
    colors: list[str] = []
    for variant in update.get("variants") or []:
        if variant.get("id"):
            continue
        color = str((variant.get("options") or {}).get(COLOR_OPTION) or "")
        if color and color not in colors:
            colors.append(color)
    return colors


def _link_new_colors(
    client: httpx.Client,
    base_url: str,
    existing: dict[str, Any],
    update: dict[str, Any],
    handle: str,
) -> None:
    """Link the update's new colours to the product before the update names them.

    `POST /admin/products/:id/options/batch` is the 2.16+ home of what the
    update payload's `options` used to do. `{value}` reuses the option's value
    of that name or creates it. A product without a «Color» option gets one.
    """
    colors = _new_variant_colors(update)
    if not colors:
        return
    option = _color_option(existing)
    if option and option.get("id"):
        body: dict[str, Any] = {
            "update": [
                {"product_option_id": option["id"], "add": [{"value": c} for c in colors]}
            ]
        }
    else:
        body = {"add": [{"title": COLOR_OPTION, "values": colors}]}
    resp = _post(client, f"{base_url}/admin/products/{existing['id']}/options/batch", json=body)
    if resp.is_error:
        raise RuntimeError(
            f"Medusa rejected the new colours {colors} of {handle!r} "
            f"with HTTP {resp.status_code}: {resp.text[:800]}"
        )


@dataclass(frozen=True)
class UpsertResult:
    """What one push did. `created` is the source of truth for "new model":
    the local state cache can be empty (a fresh container), Medusa cannot."""

    product_id: str
    created: bool
    # Existed with no thumbnail and now has one: its pictures arrived late.
    images_recovered: bool = False


def upsert_product(
    product: ScrapedProduct,
    config: Config,
    pricing: dict[str, Any],
    dry_run: bool = False,
    run_id: str | None = None,
) -> UpsertResult | None:
    """
    Upsert a product in Medusa by handle.
    Returns the product id and whether it was created, or None on dry-run.

    A created product is stamped `metadata.first_seen_at` (and the catalog run
    that found it, when there is one). That stamp is how the admin panel tells
    a new model from one the store already had; the merge in
    `_as_update_payload` keeps it on every later update.
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
        # they are not part of the default field set. Metadata is needed to keep
        # the keys this payload does not own (see _as_update_payload).
        # Options give the «Color» option id and its spellings (see
        # _as_update_payload, point 4).
        params={
            "handle": product.handle,
            "fields": "id,handle,thumbnail,metadata,*variants,*options,*options.values",
        },
    )
    search_resp.raise_for_status()
    products = search_resp.json().get("products", [])

    if products and is_manual_product(products[0]):
        # The owner's own model: the panel is its source of truth, not Capri.
        print(f"[scraper] skip {product.handle}: added by hand in the panel (source=manual).")
        return UpsertResult(product_id=str(products[0].get("id", "")), created=False)

    if products:
        existing = products[0]
        update = _as_update_payload(payload, existing)
        _link_new_colors(client, base_url, existing, update, product.handle)
        resp = _post(
            client,
            f"{base_url}/admin/products/{existing['id']}",
            json=update,
        )
    else:
        payload["metadata"]["first_seen_at"] = datetime.now(UTC).isoformat(timespec="seconds")
        if run_id:
            payload["metadata"]["first_seen_run"] = run_id
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
    return UpsertResult(
        product_id=str(resp.json().get("product", {}).get("id", "")),
        created=not products,
        images_recovered=bool(
            products and not products[0].get("thumbnail") and payload.get("thumbnail")
        ),
    )


def is_manual_product(product: dict[str, Any]) -> bool:
    """True for a model the owner added by hand in the panel.

    `POST /admin/catalog/frames` stamps `metadata.source = "manual"`
    (apps/backend/src/lib/catalog-frame.ts). Such a model is not in Capri's
    feed by definition, so the sync must neither draft it as discontinued nor
    overwrite it if Capri ever lists a model with the same handle.
    """
    return ((product.get("metadata") or {}).get("source")) == "manual"


def _list_published_handles(
    client: httpx.Client,
    base_url: str,
    target_collections: set[str],
) -> dict[str, str]:
    """Return {handle: product_id} for published products we manage.

    Scoped to our collections via metadata.collection_slug so reconciliation never
    touches products created outside this scraper — and never a model the owner
    added by hand (`is_manual_product`), even in one of our collections.
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
            if is_manual_product(p):
                continue
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
