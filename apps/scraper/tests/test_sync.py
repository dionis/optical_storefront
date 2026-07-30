"""Tests for sync.py pipeline helpers (no live HTTP)."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scraper.config import Config
from scraper.sync import _parse_product_from_html_page, _resolve_category_id


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


# The supplier returns every category regardless of any `?slug=` filter, so the
# whole list arrives whatever we ask for. Mirroring that exactly is the point of
# these tests: the old code trusted the filter and took data[0], which resolved
# EVERY collection to 4u (id 470) and would have ingested it once per collection.
SUPPLIER_CATEGORIES = [
    {"id": 470, "slug": "4u", "name": "4U", "count": 134},
    {"id": 31, "slug": "peachtree", "name": "Peachtree", "count": 54},
    {"id": 371, "slug": "grande", "name": "Grande", "count": 15},
    {"id": 140, "slug": "case", "name": "Case", "count": 28},
]


def _client_returning(payload: object, status_code: int = 200) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json = MagicMock(return_value=payload)
    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    return client


class TestResolveCategoryId:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("slug", "expected"),
        [("grande", 371), ("4u", 470), ("peachtree", 31), ("case", 140)],
    )
    async def test_matches_the_requested_slug(self, slug: str, expected: int) -> None:
        client = _client_returning(SUPPLIER_CATEGORIES)
        assert await _resolve_category_id(client, Config(), slug) == expected

    @pytest.mark.asyncio
    async def test_does_not_fall_back_to_the_first_category(self) -> None:
        """The regression: 'grande' must never resolve to 4u's id."""
        client = _client_returning(SUPPLIER_CATEGORIES)
        assert await _resolve_category_id(client, Config(), "grande") != 470

    @pytest.mark.asyncio
    async def test_slug_match_is_case_insensitive(self) -> None:
        client = _client_returning(SUPPLIER_CATEGORIES)
        assert await _resolve_category_id(client, Config(), "  GRANDE ") == 371

    @pytest.mark.asyncio
    async def test_unknown_slug_returns_none(self) -> None:
        client = _client_returning(SUPPLIER_CATEGORIES)
        assert await _resolve_category_id(client, Config(), "no-such-brand") is None

    @pytest.mark.asyncio
    async def test_not_modified_returns_none(self) -> None:
        client = _client_returning(SUPPLIER_CATEGORIES, status_code=304)
        assert await _resolve_category_id(client, Config(), "grande") is None

    @pytest.mark.asyncio
    async def test_malformed_payload_returns_none(self) -> None:
        client = _client_returning({"error": "boom"})
        assert await _resolve_category_id(client, Config(), "grande") is None
