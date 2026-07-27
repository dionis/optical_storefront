"""Unit tests for the Medusa Admin API payload builder — no live HTTP."""

from scraper.medusa_push import _build_medusa_payload
from scraper.models import FrameSize, ScrapedProduct

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
        assert real_price == 12900  # from pricing.yaml rules, untouched by filler

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
