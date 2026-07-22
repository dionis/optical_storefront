"""
Deterministic filler data for display-only catalog metadata (rating, review count,
best-seller flag, "compare at" price) that the supplier does not provide.

Seeded purely from the product handle (a SHA-256 digest, no RNG/timestamp) so
re-running the scraper on an unchanged product always reproduces identical values —
the storefront must never show these fields jumping around between syncs.

This data is presentation-only: it must never be read by pricing or checkout logic.
"""

import hashlib
from dataclasses import dataclass


@dataclass
class FillerData:
    rating: float
    review_count: int
    best_seller: bool
    original_price_cents: int | None


def generate_filler(handle: str, price_cents: int) -> FillerData:
    digest = hashlib.sha256(handle.encode()).digest()

    # Independent byte ranges so fields don't visibly correlate with each other.
    rating = 3.5 + (digest[0] / 255) * 1.5  # 3.5–5.0
    rating = round(rating, 1)

    review_count = 8 + (int.from_bytes(digest[1:3], "big") % 240)  # 8–247

    best_seller = (digest[3] % 5) == 0  # ~20% true

    has_discount = (digest[4] % 5) < 2  # ~40% true
    original_price_cents: int | None = None
    if has_discount:
        markup_pct = 10 + (digest[5] % 26)  # 10–35%
        original_price_cents = round(price_cents * (1 + markup_pct / 100))

    return FillerData(
        rating=rating,
        review_count=review_count,
        best_seller=best_seller,
        original_price_cents=original_price_cents,
    )
