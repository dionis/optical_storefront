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
        data = {
            "id": 123,
            "name": "Di Caprio DC101",
            "images": [{"src": "https://caprioptics.com/wp-content/uploads/DC101_Black.jpg"}],
            "attributes": [
                {"name": "Color", "options": [{"name": "Black"}, {"name": "Tortoise"}]},
                {"name": "Size", "options": [{"name": "52-16-140"}]},
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
        assert len(product.image_urls) == 1
        assert product.content_hash  # hash should be computed

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
