import { model } from "@medusajs/framework/utils";

export const PrescriptionRecord = model.define("prescription", {
  id: model.id().primaryKey(),
  // Right eye (OD)
  od_sph: model.float().nullable(),
  od_cyl: model.float().nullable(),
  od_axis: model.number().nullable(),
  od_add: model.float().nullable(),
  od_prism: model.float().nullable(),
  od_base: model.text().nullable(),
  // Left eye (OS)
  os_sph: model.float().nullable(),
  os_cyl: model.float().nullable(),
  os_axis: model.number().nullable(),
  os_add: model.float().nullable(),
  os_prism: model.float().nullable(),
  os_base: model.text().nullable(),
  // PD
  pd: model.float().nullable(),
  pd_od: model.float().nullable(),
  pd_os: model.float().nullable(),
  // Metadata
  source: model.enum(["manual", "ocr"]).default("manual"),
  verified_by_user: model.boolean().default(false),
  /** R2 object key of uploaded prescription image/PDF — null for manual entry */
  file_url: model.text().nullable(),
  /** Customer ID (Medusa customer) — nullable for guest checkout */
  customer_id: model.text().nullable(),
});
