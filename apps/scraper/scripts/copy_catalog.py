"""Copy the finished catalog from one Medusa backend to another (production -> staging).

The scraper rebuilds a catalog from the supplier: one HTML fetch per model and
~2.5 s of background removal per image, over an hour for the whole catalog. A
staging backend or a new store's deployment does not need that: production
already holds every product finished (owner prices, translations, R2 image keys,
attributes). This reads them there and upserts them by handle on the target,
with no image processing and no requests to the supplier.

    SOURCE  = MEDUSA_BACKEND_URL / MEDUSA_ADMIN_API_KEY from apps/scraper/.env
              (production). Only ever read: the script sends no write to it.
    TARGET  = TARGET_MEDUSA_URL / TARGET_MEDUSA_ADMIN_API_KEY /
              TARGET_SALES_CHANNEL_ID from the environment.

    uv run python scripts/copy_catalog.py            # plan: counts, writes nothing
    uv run python scripts/copy_catalog.py --apply    # copy

Products already on the target (e.g. from an interrupted scraper run) are
updated in place, variants matched by SKU, so nothing is duplicated. Images are
R2 keys shared by both environments, so nothing is uploaded.
"""

from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper.medusa_push import _as_update_payload  # noqa: E402

FIELDS = (
    "id,title,subtitle,description,handle,status,thumbnail,metadata,"
    "*images,*options,*options.values,*variants,*variants.prices,*variants.options,*sales_channels"
)


def client(url: str, key: str) -> httpx.Client:
    # Medusa v2 secret keys authenticate via HTTP Basic (key as user, no password).
    return httpx.Client(
        base_url=url.rstrip("/"),
        auth=(key, ""),
        headers={"Content-Type": "application/json"},
        timeout=httpx.Timeout(60.0, connect=15.0),
        transport=httpx.HTTPTransport(retries=3),
    )


def list_products(c: httpx.Client) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        r = c.get("/admin/products", params={"limit": 100, "offset": offset, "fields": FIELDS})
        r.raise_for_status()
        data = r.json()
        out.extend(data["products"])
        offset += 100
        if offset >= data.get("count", 0):
            return out


def to_payload(p: dict[str, Any], sales_channel_id: str) -> dict[str, Any]:
    """A create payload for the target, from a source product."""
    option_title = {o["id"]: o["title"] for o in p.get("options") or []}
    variants = []
    for v in p.get("variants") or []:
        prices: dict[str, float] = {}
        for pr in v.get("prices") or []:
            # Plain currency prices only; region/rule prices are not ours.
            if not pr.get("rules") and pr.get("currency_code") not in prices:
                prices[pr["currency_code"]] = pr["amount"]
        variants.append({
            "title": v.get("title"),
            "sku": v.get("sku"),
            "barcode": v.get("barcode"),
            "ean": v.get("ean"),
            "upc": v.get("upc"),
            "manage_inventory": bool(v.get("manage_inventory")),
            "allow_backorder": bool(v.get("allow_backorder")),
            "options": {option_title.get(o.get("option_id"), "Color"): o.get("value") for o in v.get("options") or []},
            "prices": [{"currency_code": cur, "amount": amt} for cur, amt in prices.items()],
            "metadata": v.get("metadata"),
        })
    return {
        "title": p["title"],
        "subtitle": p.get("subtitle"),
        "description": p.get("description"),
        "handle": p["handle"],
        "status": p.get("status") or "draft",
        "thumbnail": p.get("thumbnail"),
        "images": [{"url": i["url"]} for i in p.get("images") or [] if i.get("url")],
        "metadata": p.get("metadata"),
        "options": [{"title": o["title"], "values": [x["value"] for x in o.get("values") or []]} for o in p.get("options") or []],
        "variants": variants,
        "sales_channels": [{"id": sales_channel_id}],
    }


def upsert(c: httpx.Client, payload: dict[str, Any], existing: dict[str, Any] | None) -> str:
    if existing:
        r = c.post(f"/admin/products/{existing['id']}", json=_as_update_payload(payload, existing))
    else:
        r = c.post("/admin/products", json=payload)
    if r.is_error:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
    return "updated" if existing else "created"


def _price(p: dict[str, Any]) -> float | None:
    for v in p.get("variants") or []:
        for pr in v.get("prices") or []:
            if pr.get("currency_code") == "usd" and not pr.get("rules"):
                return pr["amount"]
    return None


def report(products: list[dict[str, Any]], on_target: dict[str, dict[str, Any]], channel: str) -> None:
    """How the target differs from the source, field by field. Read only."""
    from collections import Counter

    print("Target status:", dict(Counter(p.get("status") for p in on_target.values())))
    no_brand = [h for h, p in on_target.items() if not (p.get("metadata") or {}).get("brand_slug")]
    print(f"Target products without metadata.brand_slug: {len(no_brand)}")
    off_channel = [h for h, p in on_target.items() if channel not in {c.get("id") for c in p.get("sales_channels") or []}]
    print(f"Target products not in sales channel {channel}: {len(off_channel)}")
    extra = sorted(set(on_target) - {p["handle"] for p in products})
    if extra:
        print(f"Only on target ({len(extra)}): {', '.join(extra[:10])}")

    diffs: Counter[str] = Counter()
    samples: dict[str, str] = {}
    for p in products:
        t = on_target.get(p["handle"])
        if not t:
            continue
        sm, tm = p.get("metadata") or {}, t.get("metadata") or {}
        checks = {
            "status": p.get("status") != t.get("status"),
            "title": p.get("title") != t.get("title"),
            "description": p.get("description") != t.get("description"),
            "price": _price(p) != _price(t),
            "colors": sorted(v.get("title") or "" for v in p.get("variants") or [])
            != sorted(v.get("title") or "" for v in t.get("variants") or []),
            "images": [i.get("url") for i in p.get("images") or []] != [i.get("url") for i in t.get("images") or []],
            "brand_slug": sm.get("brand_slug") != tm.get("brand_slug"),
            "i18n (translations)": sm.get("i18n") != tm.get("i18n"),
            "other metadata": {k: v for k, v in sm.items() if k != "i18n"} != {k: v for k, v in tm.items() if k != "i18n"},
        }
        for name, differs in checks.items():
            if differs:
                diffs[name] += 1
                if name == "price":
                    samples.setdefault(name, f"{p['handle']}: {_price(p)} vs {_price(t)}")
                else:
                    samples.setdefault(name, p["handle"])
    if diffs:
        print("Differences source -> target (products affected, first example):")
        for name, n in diffs.most_common():
            print(f"  {name}: {n}  (e.g. {samples[name]})")
    else:
        print("Target matches source on status, text, price, colors, images and metadata.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write to the target (default: plan only)")
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    src_url, src_key = os.environ.get("MEDUSA_BACKEND_URL", ""), os.environ.get("MEDUSA_ADMIN_API_KEY", "")
    dst_url = os.environ.get("TARGET_MEDUSA_URL", "").strip()
    dst_key = os.environ.get("TARGET_MEDUSA_ADMIN_API_KEY", "").strip()
    channel = os.environ.get("TARGET_SALES_CHANNEL_ID", "").strip()
    if not (src_url and src_key and dst_url and dst_key and channel):
        sys.exit("Missing MEDUSA_BACKEND_URL/MEDUSA_ADMIN_API_KEY (.env) or TARGET_MEDUSA_URL/TARGET_MEDUSA_ADMIN_API_KEY/TARGET_SALES_CHANNEL_ID.")
    if src_url.rstrip("/") == dst_url.rstrip("/"):
        sys.exit("Source and target are the same backend — refusing.")

    print(f"Source (read only): {src_url}")
    print(f"Target:             {dst_url}  (channel {channel})")
    src, dst = client(src_url, src_key), client(dst_url, dst_key)

    products = list_products(src)
    on_target = {p["handle"]: p for p in list_products(dst)}
    new = [p for p in products if p["handle"] not in on_target]
    print(f"{len(products)} products in source; {len(on_target)} already on target; "
          f"{len(new)} to create, {len(products) - len(new)} to update.")
    if not args.apply:
        report(products, on_target, channel)
        print("Plan only. Re-run with --apply to copy.")
        return

    done = {"created": 0, "updated": 0}
    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {pool.submit(upsert, dst, to_payload(p, channel), on_target.get(p["handle"])): p["handle"] for p in products}
        for n, job in enumerate(as_completed(jobs), start=1):
            handle = jobs[job]
            try:
                done[job.result()] += 1
            except Exception as e:  # noqa: BLE001 — report and keep going
                failed.append(handle)
                print(f"  ✗ {handle}: {e}")
            if n % 25 == 0 or n == len(jobs):
                print(f"  {n}/{len(jobs)}")
    print(f"Created {done['created']}, updated {done['updated']}, failed {len(failed)}.")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
