"""Unit tests for the Medusa Admin API payload builder — no live HTTP."""

from scraper.medusa_push import _build_medusa_payload
from scraper.models import ScrapedProduct

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
