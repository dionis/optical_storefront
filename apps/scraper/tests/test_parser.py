"""Integration tests for the scraper parser.
Tests run against saved HTML fixtures — never hit the live site.
"""

import json
from pathlib import Path

import pytest

from scraper.models import ScrapedProduct
from scraper.parser import parse_product_html, parse_store_api_product, _parse_sizes


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
