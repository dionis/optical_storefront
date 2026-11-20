/**
 * The photo of the patient wearing the frame they chose (owner, 9-nov-2026):
 * taken at the counter of a physical store before the glasses are made, and
 * shown at pickup so the patient sees the glasses are the ones they ordered.
 * Optional, and it stays in the store: the photo is never put on a receipt, a
 * lab ticket, an e-mail, the Sheet or the patient file — only the sale's own
 * screen reads it, through `GET /admin/pos/sales/:id/wearing-photo`, and every
 * view is audited (`sale.wearing_photo_view`). Pure rules; the writers are in
 * lib/pos-wearing-photo-data.ts. docs/WEARING-PHOTO.md.
 */

/** Largest photo accepted, decoded (the panel reduces it to ~1600 px JPEG first). */
export const WEARING_PHOTO_MAX_BYTES = 6 * 1024 * 1024;
const DATA_URL = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * `POST /admin/pos/sales/:id/wearing-photo` { photo: data URL, consent: true }.
 * The patient's consent is required (`wearing_photo_consent`); a photo that is
 * not a JPEG / PNG / WebP data URL, or is empty or too large, is
 * `bad_wearing_photo`.
 */
export function cleanWearingPhoto(body: Record<string, unknown>): { photo: string } | { reason: string } {
  if (body["consent"] !== true) return { reason: "wearing_photo_consent" };
  const photo = body["photo"];
  if (typeof photo !== "string") return { reason: "bad_wearing_photo" };
  const m = DATA_URL.exec(photo);
  if (!m) return { reason: "bad_wearing_photo" };
  const b64 = m[2].replace(/\s/g, "");
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
  if (bytes <= 0 || bytes > WEARING_PHOTO_MAX_BYTES) return { reason: "bad_wearing_photo" };
  return { photo };
}

export { wearingPhotoDenied } from "./sale-permissions";
