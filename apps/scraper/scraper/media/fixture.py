"""Regenerates the storefront's media fixture from what has actually been generated.

WHY A FIXTURE AND NOT A LIVE READ
---------------------------------
The storefront reads generated media from a committed JS file rather than from the
Store API. That is the owner's decision (September 2026), and there is a concrete
reason behind it: turning on `VITE_USE_MEDUSA` would drop 118 frames from the
catalogue — including 20 of the 21 that have generated media — because
`medusaCatalog.js` admits only nine curated collections.

The fixture is only the BASELINE bundled with each build. The same data is also
published as a JSON manifest to the bucket (`MANIFEST_KEY`) by `media stream` at
every checkpoint, and the storefront merges it in on load — so a long generation
run shows up as it goes, without a commit or a deploy per batch.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

#: Resolved from this file, so the command works from any working directory.
FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "capri-storefront"
    / "src"
    / "data"
    / "frameMediaSample.js"
)

SLOTS = ("front", "left", "right", "back")

#: The storefront's bundled catalogue — the side of the SKU join the PDP reads.
CATALOG_PATH = FIXTURE_PATH.parents[2] / "public" / "catalog.json"

#: Where the live manifest goes in the bucket. The storefront fetches this same
#: key through resolveMedia() (`MANIFEST_KEY` in frameMediaLive.js).
MANIFEST_KEY = "media/frame-media.json"


def _slug(text: str) -> str:
    """Same rule as parser._slug, which is what built the Medusa handle."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower().strip()).strip("-")


def catalog_frames() -> dict[str, dict[str, Any]]:
    """Every catalogue frame keyed by its Medusa handle.

    The storefront joins generated media on SKU, and the queue only knows the
    handle. The pilot manifest used to be the only bridge, so every frame outside
    the 70-frame cohort was emitted with `sku = handle`, matched nothing, and its
    views never reached a product page. The handle is `{_slug(name)}-{brand_slug}`
    (parser.py), so the catalogue can rebuild the bridge for all of them.
    """
    if not CATALOG_PATH.exists():
        return {}
    rows = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    out: dict[str, dict[str, Any]] = {}
    for p in rows:
        name, brand_slug = p.get("name") or p.get("sku"), p.get("brand_slug")
        if not name or not brand_slug:
            continue
        out[f"{_slug(str(name))}-{brand_slug}"] = {
            "sku": p.get("sku"),
            "brand": p.get("brand"),
            "brand_slug": brand_slug,
            "seed_slug": re.sub(r"[^a-z0-9]+", "", str(p.get("sku") or "").lower()),
        }
    return out


_TAIL = r'''// The catalogue carries no reliable slug, so the join with generated media is done
// on a normalised SKU. Rebuilt by mergeGeneratedMedia(), so it follows the live
// manifest instead of freezing at whatever this bundle shipped with.
const _SKU_TO_HANDLE = {};
const _normSku = (sku) => String(sku || "").toLowerCase().replace(/\s+/g, "");

function _indexSkus() {
  for (const f of GENERATED_INDEX) _SKU_TO_HANDLE[_normSku(f.sku)] = f.handle;
}
_indexSkus();

/** Medusa handle for a catalogue SKU ("SL116" or "SL 116"), or undefined. */
export function handleForSku(sku) {
  return _SKU_TO_HANDLE[_normSku(sku)];
}

/**
 * Folds a newer snapshot (the live manifest a generation run publishes to the
 * bucket) into the objects above, IN PLACE: every importer keeps its reference and
 * sees the new media on its next render. Additive only — a manifest older than
 * this bundle can add nothing and remove nothing.
 */
export function mergeGeneratedMedia(manifest) {
  if (!manifest || typeof manifest !== "object") return false;
  Object.assign(GENERATED_VIEWS, manifest.views || {});
  Object.assign(GENERATED_VIDEOS, manifest.videos || {});
  const at = new Map(GENERATED_INDEX.map((f, i) => [f.handle, i]));
  for (const f of manifest.index || []) {
    if (at.has(f.handle)) GENERATED_INDEX[at.get(f.handle)] = f;
    else GENERATED_INDEX.push(f);
  }
  _indexSkus();
  return true;
}

/**
 * Merges generated media into a catalogue product, for the gallery.
 *
 * Returns the product untouched when nothing was generated for it — which is also
 * how the real thing behaves: a colourway with no media renders exactly as today.
 */
export function withGeneratedViews(product) {
  const views = product && GENERATED_VIEWS[product.slug];
  const videos = product && GENERATED_VIDEOS[product.slug];
  if (!views && !videos) return product;
  return {
    ...product,
    colors: (product.colors || []).map((colour) => ({
      ...colour,
      ...(views && views[colour.name] ? { views: views[colour.name] } : {}),
      ...(videos && videos[colour.name]
        ? { video: { src: videos[colour.name], poster: undefined } }
        : {}),
    })),
  };
}

/**
 * Generated views for a frame, by SKU ("SL116" or "SL 116" both work).
 * @returns {null | { [colorway:string]: {front,left,right,back} }} R2 keys → resolveImage()
 */
export function viewsBySku(sku) {
  const h = handleForSku(sku);
  return h ? GENERATED_VIEWS[h] || null : null;
}

/**
 * Promo videos for a frame, by SKU. Same normalisation as viewsBySku.
 * @returns {null | { [colorway:string]: string }} R2 keys → resolveMedia()
 */
export function videosBySku(sku) {
  const h = handleForSku(sku);
  return h ? GENERATED_VIDEOS[h] || null : null;
}
'''


def _js(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def collect(
    assets: list[dict[str, Any]], pilot_frames: list[dict[str, Any]]
) -> dict[str, Any]:
    """The `done` assets in the shape the storefront consumes.

    One shape for both outputs — the committed JS fixture and the live JSON
    manifest — so the two can never disagree about what exists.
    """
    raw_views: dict[str, dict[str, dict[str, str]]] = {}
    videos: dict[str, dict[str, str]] = {}

    for asset in assets:
        key = asset.get("output_key")
        if not key:
            continue
        handle = asset["product_handle"]
        colour = asset.get("colorway") or "Default"
        if asset["kind"] == "view" and asset.get("slot"):
            raw_views.setdefault(handle, {}).setdefault(colour, {})[asset["slot"]] = key
        elif asset["kind"] == "video":
            videos.setdefault(handle, {})[colour] = key

    # Pilot entries win: they also carry the tags and the reason for selection.
    by_handle = {**catalog_frames(), **{f["handle"]: f for f in pilot_frames}}
    handles = sorted(set(raw_views) | set(videos))

    views: dict[str, dict[str, dict[str, str]]] = {}
    index: list[dict[str, Any]] = []
    for handle in handles:
        if handle in raw_views:
            # Slots in display order, whatever order the board returned them in.
            views[handle] = {
                colour: {s: slots[s] for s in SLOTS if slots.get(s)}
                for colour, slots in raw_views[handle].items()
            }
        frame = by_handle.get(handle, {})
        index.append({
            "handle": handle,
            "sku": frame.get("sku") or handle,
            "brand": frame.get("brand") or "",
            "seedSlug": frame.get("seed_slug") or "",
            "brandSlug": frame.get("brand_slug") or "",
            "tags": frame.get("tags") or [],
            "reason": frame.get("selected_because") or "",
            "colorways": sorted(views.get(handle, {})),
            "viewCount": sum(len(s) for s in views.get(handle, {}).values()),
            "videoCount": len(videos.get(handle, {})),
        })

    return {
        "views": views,
        "videos": {h: videos[h] for h in handles if h in videos},
        "index": index,
    }


def summary(data: dict[str, Any]) -> dict[str, int]:
    return {
        "frames": len(data["index"]),
        "colorways": sum(len(c) for c in data["views"].values()),
        "views": sum(len(s) for cs in data["views"].values() for s in cs.values()),
        "videos": sum(len(c) for c in data["videos"].values()),
    }


def manifest_json(data: dict[str, Any], generated_at: str) -> bytes:
    """The live manifest: the same data as the fixture, as plain JSON."""
    return json.dumps(
        # Counts under their own key: `views` at the top level is the data itself.
        {"generated_at": generated_at, "totals": summary(data), **data},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def build(assets: list[dict[str, Any]], pilot_frames: list[dict[str, Any]]) -> str:
    """Renders the fixture module from the raw `done` assets."""
    data = collect(assets, pilot_frames)
    s = summary(data)

    out: list[str] = [
        "/**",
        " * Generated frame media, as it exists right now. GENERATED FILE — do not edit.",
        " *",
        f" * {s['frames']} frames · {s['colorways']} colourways · {s['views']} views"
        f" · {s['videos']} videos.",
        " *",
        " * The storefront reads media from here rather than from the Store API: turning",
        " * on VITE_USE_MEDUSA would drop 118 frames from the catalogue (only nine curated",
        " * collections are admitted), including almost every frame that has media.",
        " *",
        " * This is the BASELINE bundled with the build. On load, frameMediaLive.js",
        f" * fetches `{MANIFEST_KEY}` from the bucket (published by `media stream` at",
        " * every checkpoint) and merges it in, so new views show without a deploy.",
        " *",
        " * VALUES ARE R2 OBJECT KEYS, NOT URLS. Anything reading them must go through",
        " * resolveImage()/resolveMedia(), the same funnel as every other product image;",
        " * render a bare key and you get the grey 404 box instead of a loud failure.",
        " *",
        " * Regenerate to refresh the baseline:",
        " *   cd apps/scraper && uv run python -m scraper media fixture",
        " */",
        "",
        "/** Keyed by Medusa handle → colourway → slot. */",
        "export const GENERATED_VIEWS = {",
    ]

    for handle, colours in data["views"].items():
        out.append(f"  {_js(handle)}: {{")
        for colour, slots in colours.items():
            out.append(f"    {_js(colour)}: {{")
            for slot, key in slots.items():
                out.append(f"      {slot}: {_js(key)},")
            out.append("    },")
        out.append("  },")

    out += [
        "};",
        "",
        "/** Keyed by Medusa handle → colourway → the promo video's R2 key. */",
        "export const GENERATED_VIDEOS = {",
    ]
    for handle, colours in data["videos"].items():
        out.append(f"  {_js(handle)}: {{")
        for colour, key in colours.items():
            out.append(f"    {_js(colour)}: {_js(key)},")
        out.append("  },")

    out += [
        "};",
        "",
        "/** Flat list for listing what exists, and why each frame was chosen. */",
        "export const GENERATED_INDEX = [",
    ]
    for f in data["index"]:
        out.append(
            f"  {{ handle: {_js(f['handle'])}, sku: {_js(f['sku'])},"
            f" brand: {_js(f['brand'])},"
        )
        out.append(
            f"    seedSlug: {_js(f['seedSlug'])}, brandSlug: {_js(f['brandSlug'])},"
            f" tags: {_js(f['tags'])},"
        )
        out.append(
            f"    reason: {_js(f['reason'])}, colorways: {_js(f['colorways'])},"
            f" viewCount: {f['viewCount']}, videoCount: {f['videoCount']} }},"
        )

    out += ["];", "", _TAIL]
    return "\n".join(out) + "\n"
