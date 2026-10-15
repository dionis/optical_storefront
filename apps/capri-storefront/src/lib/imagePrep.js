// Normalises a prescription photo in the browser before it is uploaded.
//
// Why this exists: the funnel accepts `image/*`, so a phone hands us whatever
// its camera produced. Two of those are rejected by the backend and both showed
// up as the same dead end — the values stayed at 0.00 and the customer was told
// "we couldn't read it":
//
//   • iPhones deliver HEIC/HEIF from the photo library. The backend's multer
//     allowlist has never included it, so the request died before the OCR route
//     ran at all.
//   • A modern phone camera writes 10–25 MB per shot, over the 10 MB cap.
//
// Re-encoding here fixes both at once: the canvas gives back a JPEG, and
// capping the long edge puts every photo far below the size limit. It also cuts
// the upload on mobile data, which is the slowest part of the read.
//
// Everything is best-effort. If the browser cannot decode the file (an exotic
// format, a codec it lacks), we hand back the ORIGINAL file untouched and let
// the backend have its own attempt — degrading to today's behaviour rather than
// blocking a customer whose photo might have been fine.

/**
 * Longest edge we send. The backend downscales to ~1568 px anyway (see
 * lib/image-downscale.ts); matching it here means the bytes crossing the
 * network are already the bytes the model will read.
 */
const MAX_EDGE_PX = 1600;

/** JPEG quality. 0.85 keeps prescription digits crisp at a fraction of the size. */
const JPEG_QUALITY = 0.85;

/** Anything at or under this is already small enough to send as-is. */
const SKIP_BELOW_BYTES = 400 * 1024;

/** Formats the backend takes directly, so they never need re-encoding. */
const PASS_THROUGH = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Decode to a bitmap. `createImageBitmap` is the important call: on Safari it
 * goes through the system decoder, which is what lets a HEIC blob become a
 * canvas at all. `imageOrientation: "from-image"` applies the EXIF rotation, so
 * a photo taken sideways is not read sideways.
 */
async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the <img> path below.
    }
  }
  // Older Safari has createImageBitmap without the options argument, and
  // throws on the object form. Retry bare before giving up on it.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }
  // Last resort: an <img> element, which handles whatever the browser can
  // paint even when createImageBitmap refuses it.
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob(resolve, type, quality);
    else resolve(null);
  });
}

/**
 * Returns a File ready to upload: a JPEG within the size/format the backend
 * accepts, or the original when re-encoding is unnecessary or impossible.
 *
 * Never throws — a failure here must not cost the customer their read.
 */
export async function preparePrescriptionFile(file) {
  if (!file) return file;

  // PDFs are text, not pixels: rasterising one would destroy the very detail
  // the model reads. The backend forwards them to the API as a document block.
  if (file.type === "application/pdf") return file;

  // A small file in a format the backend already accepts needs nothing.
  if (PASS_THROUGH.has(file.type) && file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await decode(file);
    const w = bitmap.width || bitmap.naturalWidth;
    const h = bitmap.height || bitmap.naturalHeight;
    if (!w || !h) return file;

    const scale = Math.min(1, MAX_EDGE_PX / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // A prescription is dark ink on white paper; a transparent source (a PNG
    // scan) would otherwise flatten to black and become unreadable.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();

    const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
    if (!blob) return file;

    // Re-encoding is only worth it if it actually helped. For an already-small
    // JPEG the canvas round-trip can come out larger, and sending the bigger
    // one would be a straight loss.
    if (PASS_THROUGH.has(file.type) && blob.size >= file.size) return file;

    const name = file.name ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : "receta.jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    // Undecodable here — let the backend try. Worst case the customer sees the
    // same error they would have seen without this function.
    return file;
  }
}

export default preparePrescriptionFile;
