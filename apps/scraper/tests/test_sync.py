"""Tests for sync.py pipeline helpers (no live HTTP)."""

import json
from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from scraper.config import Config
from scraper.medusa_push import UpsertResult
from scraper.models import ScrapedProduct
from scraper.sync import _parse_product_from_html_page, _resolve_category_id, sync


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


@asynccontextmanager
async def _null_client(_config: Config) -> Any:
    yield MagicMock()


@pytest.fixture
def sync_harness(tmp_path: Any) -> Iterator[dict[str, Any]]:
    """Patch out every I/O boundary of sync() so only the loop's control flow runs."""
    products = [
        ScrapedProduct(model_name=f"M{i}", handle=f"h{i}", collection_slug="4u")
        for i in range(5)
    ]
    state = MagicMock()
    state.has_changed = MagicMock(return_value=True)

    with (
        patch("scraper.sync.RateLimitedClient", _null_client),
        patch("scraper.sync.StateStore", return_value=state),
        patch("scraper.sync._load_pricing", return_value={"default_price_cents": 9900}),
        patch(
            "scraper.sync._fetch_collection_products",
            AsyncMock(return_value=products),
        ),
        patch("scraper.sync._enrich_from_html", AsyncMock(side_effect=lambda _c, _cfg, p: p)),
        patch("scraper.sync.align_images_to_colors", side_effect=lambda _c, urls: urls),
        patch("scraper.sync.process_product_images", side_effect=lambda p, _c, dry_run: p),
        patch("scraper.sync.close_admin_client"),
        patch("scraper.sync.upsert_product") as upsert,
    ):
        yield {"upsert": upsert, "state": state, "products": products}


class TestSyncSurvivesTransientFailures:
    """A blip on one product used to abort the whole catalog.

    The real run died at product 118/134 on `httpx.ReadError: SSLV3_ALERT_BAD_RECORD_MAC`
    raised by the Medusa POST: `_post` only replays connect-phase errors, so a read
    error propagated out of sync() and every remaining product was lost.
    """

    @pytest.mark.asyncio
    async def test_a_failing_product_does_not_stop_the_rest(
        self, sync_harness: dict[str, Any]
    ) -> None:
        sync_harness["upsert"].side_effect = [
            UpsertResult("prod_1", created=False),
            httpx.ReadError("[SSL: SSLV3_ALERT_BAD_RECORD_MAC] sslv3 alert bad record mac"),
            UpsertResult("prod_3", created=False),
            UpsertResult("prod_4", created=False),
            UpsertResult("prod_5", created=False),
        ]

        await sync(Config(), collections=["4u"])

        assert sync_harness["upsert"].call_count == 5, "the run stopped at the failure"

    @pytest.mark.asyncio
    async def test_the_failed_product_is_not_marked_seen(
        self, sync_harness: dict[str, Any]
    ) -> None:
        """Otherwise the next run skips it as unchanged and the gap is permanent."""
        sync_harness["upsert"].side_effect = [
            UpsertResult("prod_1", created=False),
            httpx.ReadError("boom"),
            UpsertResult("prod_3", created=False),
            UpsertResult("prod_4", created=False),
            UpsertResult("prod_5", created=False),
        ]

        await sync(Config(), collections=["4u"])

        marked = {call.args[0] for call in sync_harness["state"].mark_seen.call_args_list}
        assert marked == {"h0", "h2", "h3", "h4"}
        assert "h1" not in marked

    @pytest.mark.asyncio
    async def test_a_sustained_outage_aborts_instead_of_grinding(
        self, sync_harness: dict[str, Any]
    ) -> None:
        """At ~55s a product, retrying a dead backend 130 more times helps nobody."""
        sync_harness["upsert"].side_effect = httpx.ConnectError("backend down")

        with patch("scraper.sync._MAX_CONSECUTIVE_FAILURES", 3):
            await sync(Config(), collections=["4u"])

        assert sync_harness["upsert"].call_count == 3
        sync_harness["state"].mark_seen.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_failure_streak_resets_on_success(
        self, sync_harness: dict[str, Any]
    ) -> None:
        """Alternating failures are flakiness, not an outage — keep going."""
        sync_harness["upsert"].side_effect = [
            httpx.ReadError("boom"),
            UpsertResult("prod_2", created=False),
            httpx.ReadError("boom"),
            UpsertResult("prod_4", created=False),
            httpx.ReadError("boom"),
        ]

        with patch("scraper.sync._MAX_CONSECUTIVE_FAILURES", 2):
            await sync(Config(), collections=["4u"])

        assert sync_harness["upsert"].call_count == 5


class TestSyncReport:
    """The numbers the owner reads in the panel come from here."""

    @pytest.mark.asyncio
    async def test_counts_new_updated_and_failed(self, sync_harness: dict[str, Any]) -> None:
        sync_harness["upsert"].side_effect = [
            UpsertResult("prod_1", created=True),
            UpsertResult("prod_2", created=False),
            httpx.ReadError("boom"),
            UpsertResult("prod_4", created=True),
            UpsertResult("prod_5", created=False),
        ]

        report = await sync(Config(), collections=["4u"])

        assert (report.found, report.new, report.updated, report.failed) == (5, 2, 2, 1)
        assert report.new_handles == ["h0", "h3"]
        assert report.new_products[0]["collection"] == "4u"
        assert report.errors[0]["handle"] == "h2"
        assert report.outcome == "partial"

    @pytest.mark.asyncio
    async def test_unchanged_products_are_counted_not_pushed(
        self, sync_harness: dict[str, Any]
    ) -> None:
        sync_harness["state"].has_changed.return_value = False

        report = await sync(Config(), collections=["4u"])

        assert report.unchanged == 5
        assert sync_harness["upsert"].call_count == 0
        assert report.outcome == "succeeded"

    @pytest.mark.asyncio
    async def test_a_stop_from_the_panel_ends_between_products(
        self, sync_harness: dict[str, Any]
    ) -> None:
        sync_harness["upsert"].return_value = UpsertResult("p", created=False)
        calls = iter([False, False, True])

        report = await sync(Config(), collections=["4u", "grande"], should_stop=lambda: next(calls))

        assert sync_harness["upsert"].call_count == 2
        assert report.canceled
        assert report.outcome == "canceled"
        assert report.collections == 1, "the second collection must not start"

    @pytest.mark.asyncio
    async def test_progress_reports_each_pushed_product(
        self, sync_harness: dict[str, Any]
    ) -> None:
        sync_harness["upsert"].return_value = UpsertResult("p", created=False)
        seen: list[dict[str, Any]] = []

        await sync(Config(), collections=["4u"], on_progress=seen.append)

        products = [p for p in seen if p["phase"] == "products"]
        assert [p["position"] for p in products] == [1, 2, 3, 4, 5]
        assert products[-1]["total"] == 5
        assert products[0]["collections_total"] == 1

    @pytest.mark.asyncio
    async def test_an_outage_marks_the_run_failed(self, sync_harness: dict[str, Any]) -> None:
        sync_harness["upsert"].side_effect = httpx.ConnectError("backend down")

        with patch("scraper.sync._MAX_CONSECUTIVE_FAILURES", 3):
            report = await sync(Config(), collections=["4u", "grande"])

        assert report.aborted
        assert report.outcome == "failed"
        assert report.collections == 1, "an outage must not grind through the next collection"
