import type { IFileModuleService, MedusaContainer, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { absoluteImageUrl, catalogUploadKey } from "./image-url";

/**
 * The photo of a store frame that is not in the catalog (owner, 10-nov-2026:
 * «se debe poder subir y en el recibo salir esa foto»). It is a photo of the
 * store's own merchandise, not of the patient, so it goes where the catalog
 * photos go — Medusa's file module, the PUBLIC assets bucket (or the local
 * disk) — and its absolute URL travels in the order line's
 * `metadata.store_frame.photo_url`: the receipts (roll, double, e-mail), the
 * lab ticket and the sale panel show it like a catalog photo, with no
 * presigned link. (The patient's own frame keeps the private bucket.)
 */

const DATA_URL = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/;
/** Largest photo accepted, decoded (the panel reduces it first). */
export const STORE_FRAME_PHOTO_MAX_BYTES = 6 * 1024 * 1024;

/** The data URL as { mime, base64 } when it is a JPEG/PNG/WebP within the size limit; null otherwise. Pure. */
export function parseStoreFramePhoto(dataUrl: unknown): { mime: string; ext: string; base64: string } | null {
  if (typeof dataUrl !== "string") return null;
  const m = DATA_URL.exec(dataUrl);
  if (!m) return null;
  const base64 = m[2].replace(/\s/g, "");
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes <= 0 || bytes > STORE_FRAME_PHOTO_MAX_BYTES) return null;
  const ext = m[1] === "jpg" ? "jpeg" : m[1];
  return { mime: `image/${ext}`, ext: ext === "jpeg" ? "jpg" : ext, base64 };
}

/** Stores it and answers its absolute URL; null when there is nothing valid to store or the file module failed (logged). */
export async function uploadStoreFramePhoto(container: MedusaContainer, dataUrl: unknown): Promise<string | null> {
  const parsed = parseStoreFramePhoto(dataUrl);
  if (!parsed) return null;
  try {
    const files = container.resolve<IFileModuleService>(Modules.FILE);
    const [stored] = await files.createFiles([
      {
        filename: `pos-store-frame/${catalogUploadKey(`montura.${parsed.ext}`)}`,
        mimeType: parsed.mime,
        // Base64, never "binary" (see api/admin/catalog/uploads/route.ts).
        content: parsed.base64,
        access: "public" as const,
      },
    ]);
    return absoluteImageUrl(stored?.url ?? null);
  } catch (e) {
    container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[pos] store frame photo not stored: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Adds or replaces the photo of the store frame of a sale after it was
 * recorded (`POST /admin/pos/sales/:id/store-frame-photo`): the order line
 * with `metadata.kind = "store-frame"` gets the new public URL. Reasons:
 * `no_store_frame` (404, the sale has none), `bad_store_frame_photo` (422),
 * `photo_upload_failed` (502).
 */
export async function setSaleStoreFramePhoto(
  container: MedusaContainer,
  sale: { id: string; order_id: string | null },
  photo: unknown
): Promise<{ photo_url: string } | { reason: string; status: number }> {
  if (!parseStoreFramePhoto(photo)) return { reason: "bad_store_frame_photo", status: 422 };
  if (!sale.order_id) return { reason: "no_store_frame", status: 404 };
  const pg = container.resolve<import("@mikro-orm/knex").Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const line = (await pg("order_line_item as li")
    .join("order_item as oi", "oi.item_id", "li.id")
    .where("oi.order_id", sale.order_id)
    .whereNull("li.deleted_at")
    .whereRaw(`li.metadata->>'kind' = 'store-frame'`)
    .first("li.id")) as { id: string } | undefined;
  if (!line) return { reason: "no_store_frame", status: 404 };
  const url = await uploadStoreFramePhoto(container, photo);
  if (!url) return { reason: "photo_upload_failed", status: 502 };
  // Both rows: Medusa's order_item keeps its own copy of the line's metadata and
  // `query.graph` (the receipts, the panel) reads that one first — updating only
  // order_line_item left the receipt without the photo (QA 10-nov-2026).
  const setPhoto = `metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{store_frame}', COALESCE(metadata->'store_frame', '{}'::jsonb) || jsonb_build_object('photo_url', ?::text), true), updated_at = now()`;
  await pg.transaction(async (trx) => {
    await trx.raw(`UPDATE order_line_item SET ${setPhoto} WHERE id = ?`, [url, line.id]);
    await trx.raw(`UPDATE order_item SET ${setPhoto} WHERE item_id = ? AND order_id = ? AND metadata IS NOT NULL`, [url, line.id, sale.order_id]);
  });
  return { photo_url: url };
}
