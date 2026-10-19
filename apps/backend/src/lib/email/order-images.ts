/**
 * Images that travel with an order email: the AI try-on render (face with the
 * frame).
 *
 * The uploaded prescription photo/PDF is deliberately NOT one of them: only the
 * values read from it are copied (into the email body and the sheet); the
 * original document stays in the private bucket, reachable from the admin panel.
 *
 * Renders are read server-side from the private bucket and ATTACHED to the
 * message (inline via `cid:`). Never linked: a presigned URL is a bearer token,
 * and an email is kept and forwarded for years.
 *
 * Best-effort throughout: an image that cannot be read is simply left out, and
 * the email still goes. A size budget keeps the message far below the provider
 * limit (Resend: 40 MB after base64), which an order with several pairs could
 * otherwise approach.
 */
import type { Attachment } from "@medusajs/framework/types";
import { readPrivateObject } from "../tryon-image";

/** Raw bytes budget for every image in one email (base64 adds ~33%). */
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;

export interface ImageRef {
  /** `cid` to reference from the HTML (`<img src="cid:…">`); null for a PDF. */
  cid: string | null;
  filename: string;
  isImage: boolean;
}

export interface OrderImages {
  attachments: Attachment[];
  /** Try-on renders by prescription id. */
  prescriptions: Record<string, ImageRef>;
  /** By line-item position — try-on renders of lines WITHOUT a prescription. */
  items: Record<number, ImageRef>;
}

export interface OrderImageSources {
  /** prescription id → try-on render object key. */
  prescriptions: Record<string, string | null | undefined>;
  /** line position → try-on object key (frame-only lines). */
  items: Record<number, string | null | undefined>;
}

const extOf = (contentType: string, key: string): string => {
  if (contentType === "application/pdf") return "pdf";
  const fromType = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "");
  return fromType || key.split(".").pop() || "jpg";
};

export async function loadOrderImages(
  displayId: string,
  sources: OrderImageSources
): Promise<OrderImages> {
  const out: OrderImages = { attachments: [], prescriptions: {}, items: {} };
  let budget = MAX_TOTAL_BYTES;
  let seq = 0;

  const fetchOne = async (key: string | null | undefined, base: string): Promise<ImageRef | undefined> => {
    if (!key) return undefined;
    const obj = await readPrivateObject(key);
    if (!obj || obj.buffer.length > budget) return undefined;
    budget -= obj.buffer.length;
    seq += 1;
    const isImage = obj.contentType.startsWith("image/");
    const filename = `${base}-${displayId}-${seq}.${extOf(obj.contentType, key)}`;
    const cid = isImage ? `${base}-${seq}@rubilens` : null;
    out.attachments.push({
      content: obj.buffer.toString("base64"),
      filename,
      content_type: obj.contentType,
      disposition: isImage ? "inline" : "attachment",
      ...(cid ? { id: cid } : {}),
    });
    return { cid, filename, isImage };
  };

  for (const [pid, key] of Object.entries(sources.prescriptions)) {
    const ref = await fetchOne(key, "prueba-virtual");
    if (ref) out.prescriptions[pid] = ref;
  }
  for (const [index, key] of Object.entries(sources.items)) {
    const ref = await fetchOne(key, "prueba-virtual");
    if (ref) out.items[Number(index)] = ref;
  }
  return out;
}
