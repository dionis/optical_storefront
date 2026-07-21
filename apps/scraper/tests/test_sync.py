"""Tests for sync.py pipeline helpers (no live HTTP)."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scraper.sync import _parse_product_from_html_page


MINIMAL_PRODUCT_HTML = """
<!DOCTYPE html>
<html>
<head>
<script type="application/ld+json">
{
  "@type": "Product",
  "@context": "https://schema.org",
  "name": "DC101 Black",
  "image": ["https://caprioptics.com/wp-content/uploads/DC101_Black.jpg"],
  "description": "Classic acetate frame."
}
</script>
</head>
<body>
<h1 class="product_title entry-title">DC101 Black</h1>
<table class="variations">
  <tr><th>Color</th><td>Black</td></tr>
  <tr><th>Size</th><td>52-16-140</td></tr>
</table>
</body>
</html>
"""


class TestParseProductFromHtmlPage:
    def test_extracts_from_json_ld(self) -> None:
        product = _parse_product_from_html_page(
            MINIMAL_PRODUCT_HTML,
            "https://caprioptics.com/product/dc101-black/",
            "di-caprio",
        )
        assert product is not None
        assert "dc101" in product.handle.lower()
        assert product.collection_slug == "di-caprio"
        assert len(product.image_urls) > 0

    def test_fallback_to_title_tag(self) -> None:
        html = """
        <html><body>
        <h1 class="product_title entry-title">DC200 Tortoise</h1>
        </body></html>
        """
        product = _parse_product_from_html_page(
            html,
            "https://caprioptics.com/product/dc200-tortoise/",
            "di-caprio",
        )
        assert product is not None
        assert "dc200" in product.handle.lower()

    def test_returns_none_for_empty_page(self) -> None:
        product = _parse_product_from_html_page(
            "<html><body></body></html>",
            "https://caprioptics.com/product/empty/",
            "di-caprio",
        )
        assert product is None
