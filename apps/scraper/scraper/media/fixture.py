"""Regenerates the storefront's media fixture from what has actually been generated.

WHY A FIXTURE AND NOT A LIVE READ
---------------------------------
The storefront reads generated media from a committed JS file rather than from the
Store API. That is the owner's decision (September 2026), and there is a concrete
reason behind it: turning on `VITE_USE_MEDUSA` would drop 118 frames from the
catalogue — including 20 of the 21 that have generated media — because
`medusaCatalog.js` admits only nine curated collections.

The cost of that choice is that the fixture is a snapshot: every new generation run
has to be written back into it and deployed. This command is what makes that one
step instead of a hand edit, so the snapshot cannot silently drift from reality.
"""

from __future__ import annotations

import json
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

_TAIL = r'''/**
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

/** Handles that have generated media, for "is there anything to show?" checks. */
export const GENERATED_HANDLES = GENERATED_INDEX.map((f) => f.handle);

// The catalogue carries no reliable slug, so the join with generated media is done
// on a normalised SKU — which matches for every frame in the cohort.
const _SKU_TO_HANDLE = {};
for (const f of GENERATED_INDEX) {
  _SKU_TO_HANDLE[String(f.sku || "").toLowerCase().replace(/\s+/g, "")] = f.handle;
}

function _handleFor(sku) {
  return _SKU_TO_HANDLE[String(sku || "").toLowerCase().replace(/\s+/g, "")];
}

/**
 * Generated views for a frame, by SKU ("SL116" or "SL 116" both work).
 * @returns {null | { [colorway:string]: {front,left,right,back} }} R2 keys → resolveImage()
 */
export function viewsBySku(sku) {
  const h = _handleFor(sku);
  return h ? GENERATED_VIEWS[h] || null : null;
}

/**
 * Promo videos for a frame, by SKU. Same normalisation as viewsBySku.
 * @returns {null | { [colorway:string]: string }} R2 keys → resolveMedia()
 */
export function videosBySku(sku) {
  const h = _handleFor(sku);
  return h ? GENERATED_VIDEOS[h] || null : null;
}
'''


def _js(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def build(assets: list[dict[str, Any]], pilot_frames: list[dict[str, Any]]) -> str:
    """Renders the fixture module from the raw `done` assets."""
    views: dict[str, dict[str, dict[str, str]]] = {}
    videos: dict[str, dict[str, str]] = {}

    for asset in assets:
        key = asset.get("output_key")
        if not key:
            continue
        handle = asset["product_handle"]
        colour = asset.get("colorway") or "Default"
        if asset["kind"] == "view" and asset.get("slot"):
            views.setdefault(handle, {}).setdefault(colour, {})[asset["slot"]] = key
        elif asset["kind"] == "video":
            videos.setdefault(handle, {})[colour] = key

    by_handle = {f["handle"]: f for f in pilot_frames}
    handles = sorted(set(views) | set(videos))

    total_views = sum(len(s) for cs in views.values() for s in cs.values())
    total_videos = sum(len(c) for c in videos.values())
    colourways = sum(len(c) for c in views.values())

    out: list[str] = [
        "/**",
        " * Generated frame media, as it exists right now. GENERATED FILE — do not edit.",
        " *",
        f" * {len(handles)} frames · {colourways} colourways · {total_views} views"
        f" · {total_videos} videos.",
        " *",
        " * The storefront reads media from here rather than from the Store API: turning",
        " * on VITE_USE_MEDUSA would drop 118 frames from the catalogue (only nine curated",
        " * collections are admitted), including almost every frame that has media.",
        " *",
        " * VALUES ARE R2 OBJECT KEYS, NOT URLS. Anything reading them must go through",
        " * resolveImage()/resolveMedia(), the same funnel as every other product image;",
        " * render a bare key and you get the grey 404 box instead of a loud failure.",
        " *",
        " * Regenerate after EVERY run — this snapshot is the storefront's only source:",
        " *   cd apps/scraper && uv run python -m scraper media fixture",
        " */",
        "",
        "/** Keyed by Medusa handle → colourway → slot. */",
        "export const GENERATED_VIEWS = {",
    ]

    for handle in handles:
        if handle not in views:
            continue
        out.append(f"  {_js(handle)}: {{")
        for colour, slots in views[handle].items():
            out.append(f"    {_js(colour)}: {{")
            for slot in SLOTS:
                if slots.get(slot):
                    out.append(f"      {slot}: {_js(slots[slot])},")
            out.append("    },")
        out.append("  },")

    out += [
        "};",
        "",
        "/** Keyed by Medusa handle → colourway → the promo video's R2 key. */",
        "export const GENERATED_VIDEOS = {",
    ]
    for handle in handles:
        if handle not in videos:
            continue
        out.append(f"  {_js(handle)}: {{")
        for colour, key in videos[handle].items():
            out.append(f"    {_js(colour)}: {_js(key)},")
        out.append("  },")

    out += [
        "};",
        "",
        "/** Flat list for listing what exists, and why each frame was chosen. */",
        "export const GENERATED_INDEX = [",
    ]
    for handle in handles:
        frame = by_handle.get(handle, {})
        cols = sorted(views.get(handle, {}))
        n_views = sum(len(s) for s in views.get(handle, {}).values())
        out.append(
            f"  {{ handle: {_js(handle)}, sku: {_js(frame.get('sku') or handle)},"
            f" brand: {_js(frame.get('brand') or '')},"
        )
        out.append(
            f"    seedSlug: {_js(frame.get('seed_slug') or '')},"
            f" brandSlug: {_js(frame.get('brand_slug') or '')},"
            f" tags: {_js(frame.get('tags') or [])},"
        )
        out.append(
            f"    reason: {_js(frame.get('selected_because') or '')},"
            f" colorways: {_js(cols)},"
            f" viewCount: {n_views}, videoCount: {len(videos.get(handle, {}))} }},"
        )

    out += ["];", "", _TAIL]
    return "\n".join(out) + "\n"
