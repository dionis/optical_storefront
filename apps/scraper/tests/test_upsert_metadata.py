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
from scraper.medusa_push import UpsertResult, _as_update_payload, upsert_product
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
        metadata = sent[0]["body"]["metadata"]
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
