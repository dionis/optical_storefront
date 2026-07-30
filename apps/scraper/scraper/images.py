"""Image pipeline: download → optimize → R2 upload → rembg try-on asset."""

import io
from pathlib import Path

import boto3
import httpx
from botocore.config import Config as BotoConfig
from PIL import Image

from scraper.config import Config
from scraper.models import ScrapedProduct

MAX_DIMENSION = 1600
WEBP_QUALITY = 85


def _get_s3_client(config: Config) -> object:
    return boto3.client(
        "s3",
        endpoint_url=config.r2_endpoint,
        aws_access_key_id=config.r2_access_key_id,
        aws_secret_access_key=config.r2_secret_access_key,
        region_name=config.r2_region,
        # Path-style (host/bucket/key) instead of virtual-hosted (bucket.host/key).
        # Providers other than AWS rarely hold a wildcard cert for bucket
        # subdomains — Supabase Storage fails the TLS handshake outright — while R2,
        # MinIO and Garage all accept path-style. The compatible choice everywhere.
        config=BotoConfig(s3={"addressing_style": "path"}),
    )


def _optimize_image(raw: bytes) -> bytes:
    """Resize to max 1600px on the longest edge, convert to WebP."""
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=WEBP_QUALITY)
    return buf.getvalue()


def _remove_background(raw: bytes) -> bytes:
    """Remove background from a frame image and return a transparent PNG."""
    # Import here so rembg is only loaded when needed
    from rembg import remove  # type: ignore[import-untyped]

    input_img = Image.open(io.BytesIO(raw)).convert("RGBA")
    output_img = remove(input_img)
    buf = io.BytesIO()
    output_img.save(buf, format="PNG")
    return buf.getvalue()


def process_product_images(
    product: ScrapedProduct,
    config: Config,
    dry_run: bool = False,
) -> ScrapedProduct:
    """
    For each image URL in product.image_urls:
    1. Download the image.
    2. Optimize to WebP.
    3. Upload to R2 under products/{handle}/{filename}.webp.
    4. For the first (front-view) image, generate a background-removed PNG
       and upload to R2 under tryon/{handle}_{color}.png.

    Populates product.r2_image_keys and product.r2_tryon_keys.
    Does nothing if dry_run=True.
    """
    if dry_run:
        print(f"[dry-run] Would process {len(product.image_urls)} images for {product.handle}")
        return product

    if not config.r2_configured:
        # Dev/no-R2 fallback: hotlink the supplier images (already color-aligned)
        # so products still get pictures. Mirrors the static catalog's approach.
        # Downstream treats an absolute http(s) key as a ready-to-use URL. No
        # try-on assets are generated (rembg needs the downloaded bytes).
        print("[images] R2 not configured — hotlinking supplier image URLs.")
        product.r2_image_keys = list(product.image_urls)
        return product

    s3 = _get_s3_client(config)

    for idx, url in enumerate(product.image_urls):
        try:
            with httpx.Client(timeout=60) as client:
                response = client.get(
                    url,
                    headers={"User-Agent": config.user_agent},
                    follow_redirects=True,
                )
                response.raise_for_status()
                raw = response.content

            optimized = _optimize_image(raw)
            filename = f"{product.handle}_{idx:02d}.webp"
            r2_key = f"products/{product.handle}/{filename}"

            s3.put_object(  # type: ignore[union-attr]
                Bucket=config.r2_bucket,
                Key=r2_key,
                Body=optimized,
                ContentType="image/webp",
                CacheControl="public, max-age=31536000, immutable",
            )
            product.r2_image_keys.append(r2_key)

            # Generate try-on asset for the first image of each color
            if idx < len(product.colors):
                color = product.colors[idx]
                try:
                    tryon_png = _remove_background(raw)
                    tryon_key = f"tryon/{product.handle}_{color.lower().replace(' ', '_')}.png"
                    s3.put_object(  # type: ignore[union-attr]
                        Bucket=config.r2_bucket,
                        Key=tryon_key,
                        Body=tryon_png,
                        ContentType="image/png",
                        CacheControl="public, max-age=31536000, immutable",
                    )
                    product.r2_tryon_keys.append(tryon_key)
                except Exception as rembg_err:
                    print(f"[images] rembg failed for {url}: {rembg_err}")

        except Exception as err:
            print(f"[images] Failed to process {url}: {err}")

    return product
