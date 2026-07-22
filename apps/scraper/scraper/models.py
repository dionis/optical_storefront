"""Shared data models for scraped products."""

from dataclasses import dataclass, field


@dataclass
class FrameSize:
    eye_size: int
    bridge_size: int
    temple_length: int


@dataclass
class ScrapedProduct:
    """Normalized representation of one frame model from the supplier."""

    # Core identity
    model_name: str
    handle: str  # URL-safe slug: model slug + collection
    collection_slug: str
    description_en: str = ""

    # AI-generated translations: {"es": {"title":..., "description":...}, "fr": {...}}
    translations: dict[str, dict[str, str]] = field(default_factory=dict)

    # Variants
    colors: list[str] = field(default_factory=list)
    sizes: list[FrameSize] = field(default_factory=list)

    # Per-color UPC codes  {color_name: upc}
    upc_by_color: dict[str, str] = field(default_factory=dict)

    # Physical attributes
    material: str = ""
    shape: str = ""
    style: str = ""
    gender: str = "unisex"
    age_group: str = "adult"
    features: list[str] = field(default_factory=list)

    # Measurements (A/B/ED/Circ) — may be absent
    a: float | None = None
    b: float | None = None
    ed: float | None = None
    circ: float | None = None

    # Image URLs from supplier (will be downloaded and re-hosted on R2)
    image_urls: list[str] = field(default_factory=list)

    # R2 keys after upload (populated by image pipeline)
    r2_image_keys: list[str] = field(default_factory=list)
    r2_tryon_keys: list[str] = field(default_factory=list)  # background-removed PNGs

    # Content hash for change detection
    content_hash: str = ""
