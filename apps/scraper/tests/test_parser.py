"""Integration tests for the scraper parser.
Tests run against saved HTML fixtures — never hit the live site.
"""

import json
from pathlib import Path

import pytest

from scraper.models import ScrapedProduct
from scraper.parser import (
    align_images_to_colors,
    parse_product_html,
    parse_store_api_product,
    _parse_sizes,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestParseSizes:
    def test_standard_size(self) -> None:
        sizes = _parse_sizes("52-16-140")
        assert len(sizes) == 1
        assert sizes[0].eye_size == 52
        assert sizes[0].bridge_size == 16
        assert sizes[0].temple_length == 140

    def test_multiple_sizes(self) -> None:
        sizes = _parse_sizes("52-16-140 / 54-18-145")
        assert len(sizes) == 2

    def test_no_size(self) -> None:
        sizes = _parse_sizes("no sizes here")
        assert sizes == []


class TestStoreApiParser:
    def test_parses_minimal_product(self) -> None:
        # `terms` + padded separators is what /wp-json/wc/store/v1 actually
        # returns. This fixture used the REST-v3 `options` shape instead, so the
        # suite stayed green while every real product came back with no colours
        # (collapsing to a single "Default" variant) and no measurements.
        data = {
            "id": 123,
            "name": "Di Caprio DC101",
            "images": [{"src": "https://caprioptics.com/wp-content/uploads/DC101_Black.jpg"}],
            "attributes": [
                {
                    "name": "Color",
                    "taxonomy": "pa_color",
                    "terms": [{"name": "Black"}, {"name": "Tortoise"}],
                },
                {"name": "Size", "taxonomy": "pa_size", "terms": [{"name": "52- 16- 140"}]},
            ],
            "tags": [{"name": "spring-hinge"}, {"name": "lightweight"}],
        }
        product = parse_store_api_product(data, "di-caprio")

        assert product.model_name == "Di Caprio DC101"
        assert product.collection_slug == "di-caprio"
        assert "Black" in product.colors
        assert "Tortoise" in product.colors
        assert len(product.sizes) == 1
        assert product.sizes[0].eye_size == 52
        assert product.sizes[0].bridge_size == 16
        assert product.sizes[0].temple_length == 140
        assert len(product.image_urls) == 1
        assert product.content_hash  # hash should be computed

    def test_parses_legacy_rest_v3_options_shape(self) -> None:
        """Older WooCommerce installs key attribute values as `options`."""
        data = {
            "id": 124,
            "name": "DC102",
            "images": [],
            "attributes": [
                {"name": "Color", "options": [{"name": "Gold"}]},
                {"name": "Size", "options": [{"name": "50-18-145"}]},
            ],
            "tags": [],
        }
        product = parse_store_api_product(data, "di-caprio")
        assert product.colors == ["Gold"]
        assert product.sizes[0].eye_size == 50

    def test_parses_plain_string_attribute_values(self) -> None:
        """Custom (non-taxonomy) attributes serialise as bare strings."""
        data = {
            "id": 125,
            "name": "DC103",
            "images": [],
            "attributes": [{"name": "Color", "terms": ["Crystal", "Matt Black"]}],
            "tags": [],
        }
        product = parse_store_api_product(data, "di-caprio")
        assert product.colors == ["Crystal", "Matt Black"]

    def test_reads_nominal_attributes_from_the_store_api(self) -> None:
        """Slugs are taken verbatim — they are the storefront's canonical tokens."""
        data = {
            "id": 200,
            "name": "GR 825",
            "images": [],
            "attributes": [
                {
                    "name": "Material",
                    "taxonomy": "pa_material",
                    "terms": [{"name": "Acetate", "slug": "acetate"}, {"name": "Tr90", "slug": "tr90"}],
                },
                {"name": "Shape", "taxonomy": "pa_shape", "terms": [{"name": "Cat Eye", "slug": "cat-eye"}]},
                {"name": "Style", "taxonomy": "pa_style", "terms": [{"name": "Full Frame", "slug": "full-frame"}]},
                {"name": "Gender", "taxonomy": "pa_gender", "terms": [{"name": "Men", "slug": "men"}]},
                {"name": "Age", "taxonomy": "pa_age", "terms": [{"name": "Adult", "slug": "adult"}]},
                {
                    "name": "Features",
                    "taxonomy": "pa_features",
                    "terms": [{"name": "Spring Hinge", "slug": "spring-hinge"}],
                },
            ],
            "tags": [{"name": "lightweight"}],
        }
        product = parse_store_api_product(data, "grande")

        assert product.material == "acetate"  # first of several
        assert product.shape == "cat-eye"
        assert product.style == "full-frame"
        assert product.gender == "men"
        assert product.age_group == "adult"
        assert product.features == ["lightweight", "Spring Hinge"]

    def test_measurement_attributes_are_not_mistaken_for_size(self) -> None:
        """'Bridge size (mm)' must not answer to a lookup for the Size attribute."""
        data = {
            "id": 201,
            "name": "GR 826",
            "images": [],
            "attributes": [
                {"name": "Bridge size (mm)", "taxonomy": "pa_bridge-size-mm", "terms": [{"name": "18-19 mm"}]},
                {"name": "Size", "taxonomy": "pa_size", "terms": [{"name": "58- 18- 150"}]},
            ],
            "tags": [],
        }
        product = parse_store_api_product(data, "grande")
        assert len(product.sizes) == 1
        assert product.sizes[0].eye_size == 58

    def test_both_gender_terms_resolve_to_unisex(self) -> None:
        data = {
            "id": 202,
            "name": "GR 827",
            "images": [],
            "attributes": [
                {
                    "name": "Gender",
                    "taxonomy": "pa_gender",
                    "terms": [{"name": "Men", "slug": "men"}, {"name": "Women", "slug": "women"}],
                }
            ],
            "tags": [],
        }
        assert parse_store_api_product(data, "grande").gender == "unisex"

    def test_missing_nominal_attributes_leave_defaults(self) -> None:
        data = {"id": 203, "name": "GR 828", "images": [], "attributes": [], "tags": []}
        product = parse_store_api_product(data, "grande")
        assert product.material == ""
        assert product.shape == ""
        assert product.gender == "unisex"  # model default
        assert product.age_group == "adult"

    def test_colors_absent_when_attribute_has_no_values(self) -> None:
        data = {
            "id": 126,
            "name": "DC104",
            "images": [],
            "attributes": [{"name": "Color", "taxonomy": "pa_color", "terms": []}],
            "tags": [],
        }
        product = parse_store_api_product(data, "di-caprio")
        assert product.colors == []

    def test_handle_is_slugified(self) -> None:
        data = {
            "id": 1,
            "name": "My Frame (Special Edition)",
            "images": [],
            "attributes": [],
            "tags": [],
        }
        product = parse_store_api_product(data, "trendy")
        assert " " not in product.handle
        assert "(" not in product.handle
        assert product.handle.endswith("-trendy")

    def test_captures_and_strips_html_description(self) -> None:
        data = {
            "id": 1,
            "name": "Di Caprio DC101",
            "description": "<p>A <strong>classic</strong> acetate frame.</p>",
            "images": [],
            "attributes": [],
            "tags": [],
        }
        product = parse_store_api_product(data, "di-caprio")
        assert product.description_en == "A classic acetate frame."

    def test_falls_back_to_short_description(self) -> None:
        data = {
            "id": 1,
            "name": "Di Caprio DC101",
            "short_description": "Short blurb.",
            "images": [],
            "attributes": [],
            "tags": [],
        }
        product = parse_store_api_product(data, "di-caprio")
        assert product.description_en == "Short blurb."

    def test_missing_description_is_empty_string(self) -> None:
        data = {"id": 1, "name": "Di Caprio DC101", "images": [], "attributes": [], "tags": []}
        product = parse_store_api_product(data, "di-caprio")
        assert product.description_en == ""

    def test_in_stock_defaults_true_when_absent(self) -> None:
        data = {"id": 1, "name": "DC101", "images": [], "attributes": [], "tags": []}
        product = parse_store_api_product(data, "di-caprio")
        assert product.is_in_stock is True

    def test_out_of_stock_is_captured(self) -> None:
        data = {"id": 1, "name": "DC101", "is_in_stock": False, "images": [], "attributes": [], "tags": []}
        product = parse_store_api_product(data, "di-caprio")
        assert product.is_in_stock is False

    def test_stock_change_alters_content_hash(self) -> None:
        base = {"id": 1, "name": "DC101", "images": [], "attributes": [], "tags": []}
        in_stock = parse_store_api_product({**base, "is_in_stock": True}, "di-caprio")
        out_stock = parse_store_api_product({**base, "is_in_stock": False}, "di-caprio")
        assert in_stock.content_hash != out_stock.content_hash


class TestAlignImagesToColors:
    def test_matches_each_color_to_its_image(self) -> None:
        colors = ["Black", "Light Blue", "Light Pink"]
        urls = [
            "https://cdn/DC407%20Light%20Pink.jpg",
            "https://cdn/DC407%20Black.jpg",
            "https://cdn/DC407%20Light%20Blue.jpg",
        ]
        aligned = align_images_to_colors(colors, urls)
        assert aligned[0] == "https://cdn/DC407%20Black.jpg"
        assert aligned[1] == "https://cdn/DC407%20Light%20Blue.jpg"
        assert aligned[2] == "https://cdn/DC407%20Light%20Pink.jpg"

    def test_appends_unmatched_gallery_images(self) -> None:
        colors = ["Black"]
        urls = ["https://cdn/Black.jpg", "https://cdn/detail-shot.jpg"]
        aligned = align_images_to_colors(colors, urls)
        assert aligned[0] == "https://cdn/Black.jpg"
        assert "https://cdn/detail-shot.jpg" in aligned
        assert len(aligned) == 2

    def test_falls_back_positionally_when_no_token_match(self) -> None:
        colors = ["Onyx", "Sand"]
        urls = ["https://cdn/img-a.jpg", "https://cdn/img-b.jpg"]
        aligned = align_images_to_colors(colors, urls)
        assert aligned == ["https://cdn/img-a.jpg", "https://cdn/img-b.jpg"]

    def test_reuses_featured_when_fewer_images_than_colors(self) -> None:
        colors = ["Black", "Blue", "Green"]
        urls = ["https://cdn/only-one.jpg"]
        aligned = align_images_to_colors(colors, urls)
        assert aligned[:3] == ["https://cdn/only-one.jpg"] * 3

    def test_no_colors_returns_images_unchanged(self) -> None:
        urls = ["https://cdn/a.jpg", "https://cdn/b.jpg"]
        assert align_images_to_colors([], urls) == urls


class TestHtmlParser:
    def test_parses_fixture_if_present(self) -> None:
        fixture = FIXTURES_DIR / "sample_product.html"
        if not fixture.exists():
            pytest.skip("No fixture file — add fixtures/sample_product.html to run this test.")

        product = ScrapedProduct(
            model_name="Test Frame",
            handle="test-frame-di-caprio",
            collection_slug="di-caprio",
        )
        enriched = parse_product_html(fixture.read_text(), product)
        # If measurements table is in the fixture, they should be parsed
        # (exact values depend on fixture content — just assert no crash)
        assert enriched.handle == "test-frame-di-caprio"
