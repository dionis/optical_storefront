"""Makes what has been generated so far visible, mid-run.

A checkpoint is the two steps that stand between "the file is in R2" and "a
customer sees it":

1. `media sync` — copies the R2 keys onto `variant.metadata` in Medusa, which is
   what the Store API (and anything reading it) serves.
2. The live manifest — the same data as the storefront's bundled fixture, written
   as JSON to the bucket at `MANIFEST_KEY`. The storefront fetches it on load and
   merges it over the fixture, so a new batch is on the product page without a
   commit or a deploy.

Both are idempotent and cost no API money, so a checkpoint can run as often as
wanted, and re-running one after a crash is always safe.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from scraper.config import Config
from scraper.images import _get_s3_client
from scraper.media import client as api
from scraper.media.fixture import MANIFEST_KEY, collect, manifest_json, summary

#: The board caps a page at this (MAX_LIMIT in the admin route).
_PAGE = 200


def done_assets(config: Config) -> list[dict[str, Any]]:
    """Every `done` view and video, all pages.

    Paged on purpose: one page of 200 is what froze the storefront at the first
    50 colourways while the queue kept growing behind it.
    """
    assets: list[dict[str, Any]] = []
    for kind in ("view", "video"):
        offset = 0
        while True:
            page = api.board(config, kind=kind, status="done", limit=_PAGE, offset=offset)
            batch = page.get("assets", [])
            assets.extend(batch)
            offset += len(batch)
            if not batch or not page.get("has_more"):
                break
    return assets


def publish_manifest(config: Config, pilot_frames: list[dict[str, Any]]) -> dict[str, int]:
    """Writes the live manifest to the bucket and returns its totals."""
    data = collect(done_assets(config), pilot_frames)
    body = manifest_json(data, datetime.now(timezone.utc).isoformat(timespec="seconds"))
    _get_s3_client(config).put_object(
        Bucket=config.r2_bucket,
        Key=MANIFEST_KEY,
        Body=body,
        ContentType="application/json; charset=utf-8",
        # The opposite of the product images: this key is rewritten in place every
        # checkpoint, so a cache that holds it would hide the newest batch.
        CacheControl="no-cache, max-age=0",
    )
    return summary(data)


def run_checkpoint(
    config: Config,
    handles: list[str] | None,
    pilot_frames: list[dict[str, Any]],
) -> dict[str, Any]:
    """Sync the touched frames into Medusa, then republish the manifest.

    `handles` narrows the sync to the frames this run touched — a catalogue-wide
    sync every 50 views would rewrite ~1,400 variants for nothing. The manifest
    is always complete: it is one small file and must describe everything.
    """
    synced = api.sync(config, handles=handles or None)
    totals = publish_manifest(config, pilot_frames)
    return {
        "variants_updated": synced.get("variants_updated", 0),
        "variants_unchanged": synced.get("variants_unchanged", 0),
        **totals,
    }
