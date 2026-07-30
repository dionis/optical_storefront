"""Parse product data from caprioptics.com WooCommerce HTML and Store API."""

import hashlib
import json
import re
from typing import Any
from urllib.parse import unquote

from bs4 import BeautifulSoup, Tag

from scraper.models import FrameSize, ScrapedProduct


# Eye-bridge-temple, e.g. "52-16-140". The supplier pads the separators
# inconsistently ("58- 18- 150" is what the Size attribute actually returns), so
# tolerate whitespace around the hyphens or every measurement parses as absent.
SIZE_RE = re.compile(r"(\d+)\s*-\s*(\d+)\s*-\s*(\d+)")


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


def _attribute_terms(attr: dict[str, Any]) -> list[tuple[str, str]]:
    """`(display name, slug)` pairs for a WooCommerce attribute's values.

    The Store API (`/wp-json/wc/store/v1`) calls them `terms`; the older REST API
    v3 called them `options`. Reading only `options` silently produced an empty
    list for every product against the supplier's current API — no colours (so
    every frame collapsed to a single "Default" variant) and no sizes (so the
    eye/bridge/temple measurements went null). Accept either shape, and tolerate
    plain strings, which is how some WooCommerce builds serialise custom
    (non-taxonomy) attributes.

    The slug matters as much as the name: WooCommerce already publishes exactly
    the canonical tokens the storefront maps from (`cat-eye`, `tr90`, `men`,
    `adult`), so nominal attributes are taken from it rather than re-derived.
    """
    for key in ("terms", "options"):
        values = attr.get(key)
        if not values:
            continue
        terms: list[tuple[str, str]] = []
        for value in values:
            if isinstance(value, dict):
                term_name = str(value.get("name") or "").strip()
                term_slug = str(value.get("slug") or "").strip().lower()
            else:
                term_name, term_slug = str(value).strip(), ""
            if term_name:
                terms.append((term_name, term_slug or _slug(term_name)))
        return terms
    return []


def _attribute_values(attr: dict[str, Any]) -> list[str]:
    """Display names only — for attributes shown verbatim, like colour."""
    return [name for name, _ in _attribute_terms(attr)]


def _find_attribute(data: dict[str, Any], *names: str) -> list[tuple[str, str]]:
    """Terms of the first attribute matching any of `names`.

    Matches on the taxonomy (`pa_material` -> `material`) or the display label,
    so it works whether the supplier exposes a global taxonomy attribute or a
    per-product custom one. Exact match, not substring: "Bridge size (mm)" and
    "Eye size (mm)" would both answer to a loose "size".
    """
    wanted = {n.lower() for n in names}
    for attr in data.get("attributes", []):
        taxonomy = str(attr.get("taxonomy") or "").lower()
        if taxonomy.startswith("pa_"):
            taxonomy = taxonomy[3:]
        label = str(attr.get("name") or "").strip().lower()
        if taxonomy in wanted or label in wanted:
            return _attribute_terms(attr)
    return []


def _normalize_gender(terms: list[tuple[str, str]]) -> str | None:
    """Supplier gender terms -> the storefront's men/women/unisex/kids token.

    Order matters: "women" contains "men", so it has to be tested first. A frame
    tagged with both men's and women's terms is unisex.
    """
    found: set[str] = set()
    for name, slug in terms:
        text = f"{slug} {name}".lower()
        if "unisex" in text:
            found.add("unisex")
        elif "women" in text or "ladies" in text or "lady" in text:
            found.add("women")
        elif "men" in text or "man" in text:
            found.add("men")
        elif "kid" in text or "child" in text or "youth" in text or "junior" in text:
            found.add("kids")
    if not found:
        return None
    if "unisex" in found or {"men", "women"} <= found:
        return "unisex"
    return next(iter(found))


def _normalize_age(terms: list[tuple[str, str]]) -> str | None:
    for name, slug in terms:
        text = f"{slug} {name}".lower()
        if "kid" in text or "child" in text or "youth" in text or "junior" in text:
            return "kids"
        if "adult" in text:
            return "adult"
    return None


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
            colors = _attribute_values(attr)

    # Sizes from attribute named "size"
    raw_sizes: list[FrameSize] = []
    for attr in data.get("attributes", []):
        if "size" in attr.get("name", "").lower():
            for value in _attribute_values(attr):
                raw_sizes.extend(_parse_sizes(value))

    # Nominal attributes. These used to come only from scraping the product HTML
    # page, whose selectors no longer match the supplier's markup — so every
    # freshly ingested product landed with material/shape/gender/style null and
    # the storefront's filters had nothing to filter on. They are all right here
    # in the response we already have, published as canonical slugs.
    material_terms = _find_attribute(data, "material")
    shape_terms = _find_attribute(data, "shape")
    style_terms = _find_attribute(data, "style")
    gender = _normalize_gender(_find_attribute(data, "gender"))
    age_group = _normalize_age(_find_attribute(data, "age", "age group"))

    # A frame can carry several materials ("Plastic", "Tr90"); the storefront
    # models a single primary one, so keep the first and let the rest go.
    material = material_terms[0][1] if material_terms else ""
    shape = shape_terms[0][1] if shape_terms else ""
    style = style_terms[0][1] if style_terms else ""

    # Images
    image_urls: list[str] = [
        img["src"] for img in data.get("images", []) if img.get("src")
    ]

    # Features from tags, plus the dedicated attribute ("Spring Hinge" and the
    # like live there, not in the tags). Order-preserving dedupe.
    features: list[str] = list(
        dict.fromkeys(
            [t["name"] for t in data.get("tags", []) if t.get("name")]
            + [name for name, _ in _find_attribute(data, "features", "feature")]
        )
    )

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
        source_url=str(data.get("permalink") or ""),
        image_urls=image_urls,
        features=features,
        is_in_stock=is_in_stock,
        material=material,
        shape=shape,
        style=style,
        **({"gender": gender} if gender else {}),
        **({"age_group": age_group} if age_group else {}),
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
                # Included so a supplier correction to any of these re-triggers
                # the push on an incremental sync instead of being skipped.
                "material": material,
                "shape": shape,
                "style": style,
                "gender": gender,
                "age_group": age_group,
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
    # The Store API is the primary source for these now; this page is only a
    # backstop for products whose attributes the supplier left unset there. Never
    # overwrite a value that already arrived — these selectors no longer match the
    # supplier's markup, and a partial match must not blank out good data.
    for item in soup.select(".product_meta .detail, .product-attributes li, .pa_material, .pa_shape"):
        text = item.get_text(separator=":", strip=True).lower()
        if "material" in text:
            product.material = product.material or text.split(":")[-1].strip()
        elif "shape" in text:
            product.shape = product.shape or text.split(":")[-1].strip()
        elif "style" in text:
            product.style = product.style or text.split(":")[-1].strip()
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
