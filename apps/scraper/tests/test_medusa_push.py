"""Unit tests for the Medusa Admin API payload builder and the admin GET retry
policy. All HTTP is served by `httpx.MockTransport` — nothing leaves the process."""

from collections.abc import Iterator

import httpx
import pytest
from tenacity import wait_none

from scraper.medusa_push import (
    _build_medusa_payload,
    _get,
    _get_with_retry,
    _list_published_handles,
    is_manual_product,
)
from scraper.models import FrameSize, ScrapedProduct


@pytest.fixture
def no_retry_wait() -> Iterator[None]:
    """Strip the exponential backoff so the retry tests run instantly."""
    original = _get_with_retry.retry.wait
    _get_with_retry.retry.wait = wait_none()
    yield
    _get_with_retry.retry.wait = original

PRICING = {"default_price_cents": 9900, "di-caprio": {"price_cents": 12900}}


class TestBuildMedusaPayload:
    def test_includes_description_and_i18n(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
            description_en="A classic acetate frame.",
            translations={
                "es": {"title": "DC101", "description": "Un armazón clásico."},
                "fr": {"title": "DC101", "description": "Une monture classique."},
            },
            colors=["Black"],
        )
        payload = _build_medusa_payload(product, PRICING)

        assert payload["description"] == "A classic acetate frame."
        assert payload["metadata"]["i18n"]["es"]["title"] == "DC101"
        assert payload["metadata"]["i18n"]["fr"]["description"] == "Une monture classique."

    def test_missing_description_is_none(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
        )
        payload = _build_medusa_payload(product, PRICING)
        assert payload["description"] is None

    def test_includes_deterministic_filler_metadata(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
        )
        payload_a = _build_medusa_payload(product, PRICING)
        payload_b = _build_medusa_payload(product, PRICING)

        meta_a, meta_b = payload_a["metadata"], payload_b["metadata"]
        for key in ("rating", "review_count", "best_seller", "original_price_cents"):
            assert key in meta_a
            assert meta_a[key] == meta_b[key]  # deterministic across repeated builds

        assert 3.5 <= meta_a["rating"] <= 5.0
        assert isinstance(meta_a["best_seller"], bool)

    def test_filler_never_overrides_real_price(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
            colors=["Black"],
        )
        payload = _build_medusa_payload(product, PRICING)
        real_price = payload["variants"][0]["prices"][0]["amount"]
        # pricing.yaml is cents (12900); Medusa stores dollars → 129.00.
        assert real_price == 129.0
        assert payload["variants"][0]["manage_inventory"] is False

    def test_in_stock_product_is_published(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
            is_in_stock=True,
        )
        assert _build_medusa_payload(product, PRICING)["status"] == "published"

    def test_out_of_stock_product_is_draft(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
            is_in_stock=False,
        )
        assert _build_medusa_payload(product, PRICING)["status"] == "draft"

    def test_sales_channel_absent_by_default(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
        )
        assert "sales_channels" not in _build_medusa_payload(product, PRICING)

    def test_sales_channel_added_when_provided(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
        )
        payload = _build_medusa_payload(product, PRICING, sales_channel_id="sc_123")
        assert payload["sales_channels"] == [{"id": "sc_123"}]

    def test_product_and_variants_have_color_options(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
            colors=["Black", "Grey"],
        )
        payload = _build_medusa_payload(product, PRICING)
        assert payload["options"] == [{"title": "Color", "values": ["Black", "Grey"]}]
        assert payload["variants"][0]["options"] == {"Color": "Black"}
        assert payload["variants"][1]["options"] == {"Color": "Grey"}

    def test_colorless_product_gets_default_variant(self) -> None:
        product = ScrapedProduct(
            model_name="Case C-1",
            handle="case-c-1-case",
            collection_slug="case",
        )
        payload = _build_medusa_payload(product, PRICING)
        assert payload["options"] == [{"title": "Color", "values": ["Default"]}]
        assert len(payload["variants"]) == 1
        assert payload["variants"][0]["options"] == {"Color": "Default"}

    def test_metadata_has_brand_name_and_slug(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
        )
        meta = _build_medusa_payload(product, PRICING)["metadata"]
        assert meta["brand"] == "Di Caprio"
        assert meta["brand_slug"] == "di-caprio"

    def test_metadata_has_bucketed_measurements(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
            sizes=[FrameSize(eye_size=54, bridge_size=18, temple_length=145)],
        )
        meta = _build_medusa_payload(product, PRICING)["metadata"]
        assert meta["eye_size"] == 54  # numeric kept for Meilisearch
        assert meta["eye_size_bucket"] == "54-56 mm"
        assert meta["bridge_size_bucket"] == "18-19 mm"
        assert meta["temple_length_bucket"] == "145-150 mm"

    def test_bucketed_measurements_null_without_size(self) -> None:
        product = ScrapedProduct(
            model_name="Di Caprio DC101",
            handle="dc101-di-caprio",
            collection_slug="di-caprio",
        )
        meta = _build_medusa_payload(product, PRICING)["metadata"]
        assert meta["eye_size_bucket"] is None
        assert meta["bridge_size_bucket"] is None


class TestGetRetryPolicy:
    """`_get` must survive a reverse-proxy hiccup but not mask a real rejection."""

    @staticmethod
    def _client(handler: "callable") -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(handler))

    def test_retries_gateway_error_then_succeeds(self, no_retry_wait: None) -> None:
        attempts = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            attempts["n"] += 1
            if attempts["n"] < 3:
                return httpx.Response(502, text="Bad Gateway")
            return httpx.Response(200, json={"products": []})

        with self._client(handler) as client:
            response = _get(client, "https://medusa.test/admin/products")

        assert response.status_code == 200
        assert attempts["n"] == 3

    def test_gateway_error_surfaces_after_exhausting_retries(
        self, no_retry_wait: None
    ) -> None:
        attempts = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            attempts["n"] += 1
            return httpx.Response(503, text="Service Unavailable")

        with self._client(handler) as client:
            response = _get(client, "https://medusa.test/admin/products")

        # The caller's raise_for_status() must still see the real response.
        assert attempts["n"] == 4
        assert response.status_code == 503
        with pytest.raises(httpx.HTTPStatusError):
            response.raise_for_status()

    def test_client_error_is_not_retried(self, no_retry_wait: None) -> None:
        attempts = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            attempts["n"] += 1
            return httpx.Response(422, json={"message": "invalid handle"})

        with self._client(handler) as client:
            response = _get(client, "https://medusa.test/admin/products")

        # A validation rejection is a real answer — replaying it only wastes time.
        assert attempts["n"] == 1
        assert response.status_code == 422


class TestManualProducts:
    """A model the owner added by hand (`metadata.source = "manual"`, created by
    `POST /admin/catalog/frames`) is not in Capri's feed: the sync must never
    draft it as discontinued nor overwrite it."""

    def test_is_manual_product(self) -> None:
        assert is_manual_product({"metadata": {"source": "manual"}})
        assert not is_manual_product({"metadata": {"source": "capri"}})
        assert not is_manual_product({"metadata": None})
        assert not is_manual_product({})

    def test_reconciliation_never_lists_a_manual_product(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "count": 3,
                    "products": [
                        {
                            "id": "p1",
                            "handle": "dc-407",
                            "metadata": {"collection_slug": "di-caprio"},
                        },
                        {
                            "id": "p2",
                            "handle": "dc-999",
                            "metadata": {"collection_slug": "di-caprio", "source": "manual"},
                        },
                        {
                            "id": "p3",
                            "handle": "other",
                            "metadata": {"collection_slug": "elsewhere"},
                        },
                    ],
                },
            )

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            managed = _list_published_handles(client, "https://medusa.test", {"di-caprio"})

        # The manual model shares the brand's collection and still is not "ours".
        assert managed == {"dc-407": "p1"}

    def test_upsert_never_overwrites_a_manual_product(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        import scraper.medusa_push as push

        writes: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json={
                        "products": [
                            {"id": "p9", "handle": "dc-999", "metadata": {"source": "manual"}}
                        ]
                    },
                )
            writes.append(str(request.url))
            return httpx.Response(200, json={"product": {"id": "p9"}})

        client = httpx.Client(transport=httpx.MockTransport(handler))
        monkeypatch.setattr(push, "_admin_client", lambda config: client)
        config = SimpleNamespace(
            medusa_backend_url="https://medusa.test", medusa_sales_channel_id=""
        )
        product = ScrapedProduct(
            model_name="DC999", handle="dc-999", collection_slug="di-caprio", colors=["Black"]
        )

        result = push.upsert_product(product, config, PRICING)  # type: ignore[arg-type]

        assert result is not None and result.product_id == "p9" and result.created is False
        assert writes == []
