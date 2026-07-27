"""Parse product data from caprioptics.com WooCommerce HTML and Store API."""

import hashlib
import json
import re
from typing import Any
from urllib.parse import unquote

from bs4 import BeautifulSoup, Tag

from scraper.models import FrameSize, ScrapedProduct


SIZE_RE = re.compile(r"(\d+)-(\d+)-(\d+)")


def _color_tokens(name: str) -> list[str]:
    """Tokenize a color name for URL matching: lowercase, drop leading indices/digits."""
    lowered = re.sub(r"\b\d+\s*-?\s*", " ", name.lower())
    return [t for t in re.split(r"[^a-z]+", lowered) if t]


def _token_match(name: str, urls: list[str]) -> str | None:
    """Return the first URL whose decoded path contains every token of `name`.

    Port of sync-catalog.mjs `tokenMatch`: matches a color name against image URLs
    (e.g. color "Light Blue" → ".../DC407 Light Blue.jpg").
    """
    tokens = _color_tokens(name)
    if not tokens:
        return None
    for url in urls:
        haystack = unquote(url).lower()
        if all(tok in haystack for tok in tokens):
            return url
    return None


def align_images_to_colors(
    colors: list[str], image_urls: list[str]
) -> list[str]:
    """Reorder image_urls so image[i] corresponds to colors[i].

    Matches each color name against the image URLs (token match), falling back to
    positional order, then to the first available image (mirrors sync-catalog.mjs
    color→image resolution). Images not matched to a color are appended after so the
    full product gallery is preserved. The first len(colors) entries are the
    per-color images in color order, which downstream (image upload + try-on asset)
    relies on to associate each variant with its own photo.
    """
    if not colors:
        return list(image_urls)

    used: set[str] = set()
    ordered: list[str] = []
    for idx, color in enumerate(colors):
        remaining = [u for u in image_urls if u not in used]
        chosen = _token_match(color, remaining)
        if chosen is None:
            if idx < len(image_urls) and image_urls[idx] not in used:
                chosen = image_urls[idx]          # positional fallback
            elif remaining:
                chosen = remaining[0]             # first still-unused image
            elif image_urls:
                chosen = image_urls[0]            # reuse featured image
        if chosen is not None:
            ordered.append(chosen)
            used.add(chosen)

    ordered.extend([u for u in image_urls if u not in used])  # leftover gallery
    return ordered


def _parse_sizes(raw: str) -> list[FrameSize]:
    """Parse size strings like '52-16-140' or '52-16-140 / 54-18-140'."""
    sizes: list[FrameSize] = []
    for match in SIZE_RE.finditer(raw):
        sizes.append(
            FrameSize(
                eye_size=int(match.group(1)),
                bridge_size=int(match.group(2)),
                temple_length=int(match.group(3)),
            )
        )
    return sizes


def _slug(text: str) -> str:
    """Convert a model name to a URL-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def parse_store_api_product(
    data: dict[str, Any], collection_slug: str
) -> ScrapedProduct:
    """Build a ScrapedProduct from a WooCommerce Store API product object."""
    name: str = data.get("name", "")
    handle = f"{_slug(name)}-{collection_slug}"

    # Colors come from variations or attributes
    colors: list[str] = []
    for attr in data.get("attributes", []):
        if attr.get("name", "").lower() in ("color", "colour", "color/frame"):
            colors = [o["name"] for o in attr.get("options", [])]

    # Sizes from attribute named "size"
    raw_sizes: list[FrameSize] = []
    for attr in data.get("attributes", []):
        if "size" in attr.get("name", "").lower():
            for opt in attr.get("options", []):
                raw_sizes.extend(_parse_sizes(opt["name"]))

    # Images
    image_urls: list[str] = [
        img["src"] for img in data.get("images", []) if img.get("src")
    ]

    # Features from tags
    features: list[str] = [t["name"] for t in data.get("tags", [])]

    # English description (WooCommerce returns HTML; strip to plain text)
    raw_description = data.get("description") or data.get("short_description") or ""
    description_en = BeautifulSoup(raw_description, "lxml").get_text(" ", strip=True)

    # Availability gate: the Store API exposes stock via `is_in_stock` (default to
    # available when the field is absent).
    is_in_stock = bool(data.get("is_in_stock", True))

    product = ScrapedProduct(
        model_name=name,
        handle=handle,
        collection_slug=collection_slug,
        description_en=description_en,
        colors=colors,
        sizes=raw_sizes,
        image_urls=image_urls,
        features=features,
        is_in_stock=is_in_stock,
    )

    # Compute content hash for change detection. Include stock so a transition
    # (available ↔ out of stock) re-triggers the push even if nothing else changed.
    product.content_hash = hashlib.sha256(
        json.dumps(
            {
                "name": name,
                "description": description_en,
                "colors": sorted(colors),
                "sizes": [
                    (s.eye_size, s.bridge_size, s.temple_length) for s in raw_sizes
                ],
                "images": sorted(image_urls),
                "in_stock": is_in_stock,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()

    return product


def parse_product_html(
    html: str, product: ScrapedProduct
) -> ScrapedProduct:
    """
    Enrich a ScrapedProduct with data available only in the product HTML page:
    per-color UPC codes, A/B/ED/Circ measurements, material, shape, style.
    """
    soup = BeautifulSoup(html, "lxml")

    # ----- Measurements table -----
    for row in soup.select("table tr, .product-measurements tr"):
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        label = cells[0].get_text(strip=True).upper()
        value_text = cells[1].get_text(strip=True)
        try:
            value = float(re.sub(r"[^0-9.]", "", value_text))
        except ValueError:
            continue
        if label in ("A", "A MEASUREMENT"):
            product.a = value
        elif label in ("B", "B MEASUREMENT"):
            product.b = value
        elif label in ("ED", "EFFECTIVE DIAMETER"):
            product.ed = value
        elif label in ("CIRC", "CIRCUMFERENCE"):
            product.circ = value

    # ----- UPC table (per color) -----
    upc_table = soup.find("table", class_=re.compile(r"upc|sku", re.I))
    if isinstance(upc_table, Tag):
        for row in upc_table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) >= 2:
                color_text = cells[0].get_text(strip=True)
                upc_text = cells[-1].get_text(strip=True)
                if upc_text.isdigit() and len(upc_text) >= 6:
                    product.upc_by_color[color_text] = upc_text

    # ----- Product attributes (material, shape, etc.) -----
    for item in soup.select(".product_meta .detail, .product-attributes li, .pa_material, .pa_shape"):
        text = item.get_text(separator=":", strip=True).lower()
        if "material" in text:
            product.material = text.split(":")[-1].strip()
        elif "shape" in text:
            product.shape = text.split(":")[-1].strip()
        elif "style" in text:
            product.style = text.split(":")[-1].strip()
        elif "gender" in text or "frame for" in text:
            raw = text.split(":")[-1].strip()
            if "men" in raw and "women" in raw:
                product.gender = "unisex"
            elif "women" in raw or "ladies" in raw:
                product.gender = "women"
            elif "men" in raw:
                product.gender = "men"
        elif "kid" in text or "child" in text:
            product.age_group = "kids"

    # ----- Additional image URLs from gallery -----
    gallery_imgs = soup.select(".woocommerce-product-gallery__image img, .wp-post-image")
    for img in gallery_imgs:
        if isinstance(img, Tag):
            src = img.get("data-large_image") or img.get("src")
            if src and isinstance(src, str) and src not in product.image_urls:
                product.image_urls.append(src)

    return product
