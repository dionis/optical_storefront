"""`upsert_product` and the metadata it must not lose.

Medusa 2.17 REPLACES `metadata` on update. These pin the two consequences that
matter: a product keeps the `first_seen_at` that marks it as a new model, and a
variant keeps the generated views `media sync` copied onto it. All HTTP is a
`httpx.MockTransport`.
"""

import json
from typing import Any
from unittest.mock import patch

import httpx

from scraper.config import Config
from scraper.medusa_push import (
    UpsertResult,
    _as_update_payload,
    _new_variant_colors,
    upsert_product,
)
from scraper.models import ScrapedProduct

PRICING = {"default_price_cents": 9900}


def _product() -> ScrapedProduct:
    return ScrapedProduct(
        model_name="DC101",
        handle="dc101-di-caprio",
        collection_slug="di-caprio",
        colors=["Black"],
        upc_by_color={"Black": "111"},
    )


def _client(existing: list[dict[str, Any]], sent: list[dict[str, Any]]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"products": existing})
        sent.append({"url": str(request.url), "body": json.loads(request.content)})
        return httpx.Response(200, json={"product": {"id": "prod_1"}})

    return httpx.Client(transport=httpx.MockTransport(handler))


class TestFirstSeen:
    def test_a_created_product_is_stamped_and_reported_new(self) -> None:
        sent: list[dict[str, Any]] = []
        with patch("scraper.medusa_push._admin_client", return_value=_client([], sent)):
            result = upsert_product(_product(), Config(), PRICING, run_id="csrun_1")

        assert result == UpsertResult("prod_1", created=True)
        metadata = sent[0]["body"]["metadata"]
        assert metadata["first_seen_at"]
        assert metadata["first_seen_run"] == "csrun_1"

    def test_an_update_keeps_the_original_stamp(self) -> None:
        sent: list[dict[str, Any]] = []
        existing = [{
            "id": "prod_1",
            "metadata": {"first_seen_at": "2026-10-01T06:00:00+00:00", "brand": "Old"},
            "variants": [],
        }]
        with patch("scraper.medusa_push._admin_client", return_value=_client(existing, sent)):
            result = upsert_product(_product(), Config(), PRICING)

        assert result == UpsertResult("prod_1", created=False)
        # The last call is the update; the colour link may precede it.
        metadata = sent[-1]["body"]["metadata"]
        assert metadata["first_seen_at"] == "2026-10-01T06:00:00+00:00"
        assert metadata["brand"] == "Di Caprio", "the scraper's own keys still win"


class TestUpdateMergesMetadata:
    def test_variant_keeps_generated_views(self) -> None:
        payload = {
            "metadata": {"brand": "New"},
            "variants": [{
                "sku": "111",
                "title": "Black",
                "metadata": {"color": "Black", "image": "a.webp"},
            }],
        }
        existing = {
            "metadata": {"first_seen_at": "x"},
            "variants": [{
                "id": "variant_1",
                "sku": "111",
                "title": "Black",
                "metadata": {"views": {"front": "v.webp"}, "image": "old.webp"},
            }],
        }

        update = _as_update_payload(payload, existing)

        variant = update["variants"][0]
        assert variant["id"] == "variant_1"
        assert variant["metadata"]["views"] == {"front": "v.webp"}
        assert variant["metadata"]["image"] == "a.webp"
        assert update["metadata"] == {"first_seen_at": "x", "brand": "New"}


def _color(*values: str) -> list[dict[str, Any]]:
    return [{
        "id": "opt_color",
        "title": "Color",
        "values": [{"id": f"optval_{v}", "value": v} for v in values],
    }]


class TestUpdateColorOptions:
    """«Option value Black does not exist for option Color» rejected the whole
    update of 10 models on every run: since 2.16 the update cannot touch the
    product's options, yet each variant still named its colour."""

    def test_a_matched_variant_sends_no_options(self) -> None:
        payload = {
            "variants": [{"sku": "111", "title": "Black", "options": {"Color": "Black"}}]
        }
        existing = {
            "options": _color("BLACK"),
            "variants": [{"id": "variant_1", "sku": "111", "title": "BLACK"}],
        }

        variant = _as_update_payload(payload, existing)["variants"][0]

        assert variant["id"] == "variant_1"
        assert "options" not in variant

    def test_title_match_ignores_case(self) -> None:
        payload = {
            "variants": [{"sku": "new-sku", "title": "Brown", "options": {"Color": "Brown"}}]
        }
        existing = {"variants": [{"id": "variant_2", "sku": "old-sku", "title": "BROWN"}]}

        variant = _as_update_payload(payload, existing)["variants"][0]

        assert variant["id"] == "variant_2", "no duplicate Brown next to BROWN"

    def test_a_new_colour_reuses_the_products_spelling(self) -> None:
        payload = {
            "variants": [{"sku": "u32-tan", "title": "Tan", "options": {"Color": "Tan"}}]
        }
        existing = {"options": _color("Black", "TAN"), "variants": []}

        update = _as_update_payload(payload, existing)

        assert update["variants"][0]["options"] == {"Color": "TAN"}
        assert _new_variant_colors(update) == ["TAN"]

    def test_the_new_colour_is_linked_before_the_update(self) -> None:
        sent: list[dict[str, Any]] = []
        product = ScrapedProduct(
            model_name="U32",
            handle="u-32-4u",
            collection_slug="4u",
            colors=["Black", "Brown"],
            upc_by_color={"Black": "111", "Brown": "222"},
        )
        existing = [{
            "id": "prod_1",
            "metadata": {},
            "options": _color("Black"),
            "variants": [{"id": "variant_1", "sku": "111", "title": "Black"}],
        }]
        with patch("scraper.medusa_push._admin_client", return_value=_client(existing, sent)):
            upsert_product(product, Config(), PRICING)

        link, update = sent
        assert link["url"].endswith("/admin/products/prod_1/options/batch")
        assert link["body"] == {
            "update": [{"product_option_id": "opt_color", "add": [{"value": "Brown"}]}]
        }
        assert update["url"].endswith("/admin/products/prod_1")
        black, brown = update["body"]["variants"]
        assert "options" not in black
        assert brown["options"] == {"Color": "Brown"} and "id" not in brown

    def test_no_new_colour_means_no_link_call(self) -> None:
        sent: list[dict[str, Any]] = []
        existing = [{
            "id": "prod_1",
            "metadata": {},
            "options": _color("Black"),
            "variants": [{"id": "variant_1", "sku": "111", "title": "Black"}],
        }]
        with patch("scraper.medusa_push._admin_client", return_value=_client(existing, sent)):
            upsert_product(_product(), Config(), PRICING)

        assert [s["url"].rsplit("/", 1)[-1] for s in sent] == ["prod_1"]


class TestImagesRecovered:
    def test_a_bare_product_that_gets_pictures_is_flagged(self) -> None:
        product = _product()
        product.r2_image_keys = ["products/dc101/dc101_00.webp"]
        existing = [{"id": "prod_1", "thumbnail": None, "metadata": {}, "variants": []}]
        with patch("scraper.medusa_push._admin_client", return_value=_client(existing, [])):
            result = upsert_product(product, Config(), PRICING)

        assert result == UpsertResult("prod_1", created=False, images_recovered=True)

    def test_a_product_that_had_pictures_is_not(self) -> None:
        product = _product()
        product.r2_image_keys = ["products/dc101/dc101_00.webp"]
        existing = [{"id": "prod_1", "thumbnail": "old.webp", "metadata": {}, "variants": []}]
        with patch("scraper.medusa_push._admin_client", return_value=_client(existing, [])):
            result = upsert_product(product, Config(), PRICING)

        assert result.images_recovered is False
