import sharp from "sharp";

export interface DownscaleResult {
  buffer: Buffer;
  media_type: string;
  /** True when the image was actually re-encoded. */
  resized: boolean;
  original_bytes: number;
  final_bytes: number;
}

/**
 * Shrink an image so its longest edge is at most `maxEdgePx` before it goes to
 * the vision API.
 *
 * This is the single highest-leverage cost control in the OCR path: image
 * tokens scale with *area*, so halving the long edge quarters the bill. A
 * 3024x4032 phone photo costs ~6,600 tokens at full size and ~2,500 at 1568 px,
 * which is still far more resolution than a prescription table needs.
 *
 * Failures are non-fatal — we fall back to the original bytes rather than lose
 * the read, since a costlier request beats a broken one.
 */
export async function downscaleForOcr(
  input: Buffer,
  mediaType: string,
  maxEdgePx: number
): Promise<DownscaleResult> {
  const unchanged: DownscaleResult = {
    buffer: input,
    media_type: mediaType,
    resized: false,
    original_bytes: input.length,
    final_bytes: input.length,
  };

  // PDFs are passed through untouched: sharp cannot rasterise them, and the
  // API renders their pages itself.
  if (!mediaType.startsWith("image/")) return unchanged;

  // HEIC/HEIF must be re-encoded whatever its size — the vision API does not
  // accept the format at all, so "already small enough" is not a reason to skip
  // the conversion the way it is for a JPEG.
  const mustTranscode = mediaType === "image/heic" || mediaType === "image/heif";

  try {
    const image = sharp(input, { failOn: "none" });
    const { width, height } = await image.metadata();
    if (!width || !height) return unchanged;
    if (!mustTranscode && Math.max(width, height) <= maxEdgePx) return unchanged;

    // JPEG at quality 85 keeps prescription digits legible while cutting the
    // upload well below the 10 MB cap.
    const buffer = await image
      .rotate() // honour EXIF orientation before dropping the metadata
      .resize({ width: maxEdgePx, height: maxEdgePx, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    return {
      buffer,
      media_type: "image/jpeg",
      resized: true,
      original_bytes: input.length,
      final_bytes: buffer.length,
    };
  } catch {
    return unchanged;
  }
}
