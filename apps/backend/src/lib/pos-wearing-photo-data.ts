import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { recordAudit } from "./audit";
import { getSale, PosError, type SaleRow } from "./pos-data";
import { storageConfigured } from "./s3";
import { deletePrivateObject, POS_WEAR_KEY_PATTERN, readPrivateObject, uploadPrivateImage, type PrivateObject } from "./tryon-image";

/**
 * Writers and reader of the photo of the patient wearing the frame
 * (lib/pos-wearing-photo.ts). The photo lives in the private bucket under
 * `poswear/`; the sale row keeps its key, which never leaves the backend.
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

async function currentKey(container: MedusaContainer, saleId: string): Promise<string | null> {
  const row = (await pgOf(container)("pos_sale").where({ id: saleId }).whereNull("deleted_at").first("wearing_photo_key")) as { wearing_photo_key?: string | null } | undefined;
  return row?.wearing_photo_key ?? null;
}

/** Takes (or replaces) the photo. `storage_unavailable` (503) without the private bucket; `photo_upload_failed` (502) when it refused. */
export async function setWearingPhoto(container: MedusaContainer, sale: SaleRow, photo: string, actorId: string | null): Promise<SaleRow> {
  if (!storageConfigured()) throw new PosError("storage_unavailable", 503);
  const key = await uploadPrivateImage(photo, "poswear");
  if (!key) throw new PosError("photo_upload_failed", 502);
  const previous = await currentKey(container, sale.id);
  const now = new Date();
  const n = await pgOf(container)("pos_sale")
    .where({ id: sale.id })
    .whereNull("deleted_at")
    .update({ wearing_photo_key: key, wearing_photo_at: now, wearing_photo_by: actorId, wearing_photo_consent_at: now, updated_at: now });
  if (!n) {
    await deletePrivateObject(key);
    throw new PosError("sale_not_found", 404);
  }
  if (previous && previous !== key) await deletePrivateObject(previous);
  await recordAudit(container, {
    actorId,
    action: "sale.wearing_photo",
    entity: "pos_sale",
    entityId: sale.id,
    establishmentId: sale.establishment_id,
    before: { number: sale.number, had_photo: Boolean(previous) },
    after: { op: previous ? "replace" : "add" },
  });
  return (await getSale(container, sale.id)) ?? sale;
}

/** Removes the photo (row and file). `no_wearing_photo` (404) when there is none. */
export async function removeWearingPhoto(container: MedusaContainer, sale: SaleRow, actorId: string | null): Promise<SaleRow> {
  const previous = await currentKey(container, sale.id);
  if (!previous) throw new PosError("no_wearing_photo", 404);
  await pgOf(container)("pos_sale")
    .where({ id: sale.id })
    .update({ wearing_photo_key: null, wearing_photo_at: null, wearing_photo_by: null, wearing_photo_consent_at: null, updated_at: new Date() });
  await deletePrivateObject(previous);
  await recordAudit(container, {
    actorId,
    action: "sale.wearing_photo",
    entity: "pos_sale",
    entityId: sale.id,
    establishmentId: sale.establishment_id,
    before: { number: sale.number, had_photo: true },
    after: { op: "remove" },
  });
  return (await getSale(container, sale.id)) ?? sale;
}

/** The photo's bytes, for the sale's screen; each read is audited. `no_wearing_photo` (404) when there is none or the file is gone. */
export async function readWearingPhoto(container: MedusaContainer, sale: SaleRow, actorId: string | null): Promise<PrivateObject> {
  const key = await currentKey(container, sale.id);
  if (!key || !POS_WEAR_KEY_PATTERN.test(key)) throw new PosError("no_wearing_photo", 404);
  const obj = await readPrivateObject(key);
  if (!obj) throw new PosError("no_wearing_photo", 404);
  await recordAudit(container, {
    actorId,
    action: "sale.wearing_photo_view",
    entity: "pos_sale",
    entityId: sale.id,
    establishmentId: sale.establishment_id,
    after: { number: sale.number },
  });
  return obj;
}
