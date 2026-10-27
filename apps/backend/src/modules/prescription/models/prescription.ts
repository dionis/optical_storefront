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
  /** Fitting/segment height in mm — required to cut a progressive/bifocal */
  seg_height: model.float().nullable(),
  // Metadata
  source: model.enum(["manual", "ocr"]).default("manual"),
  verified_by_user: model.boolean().default(false),
  /** R2 object key of uploaded prescription image/PDF — null for manual entry */
  file_url: model.text().nullable(),
  /** R2 object key of the AI try-on render (face with frame) — null when unused */
  tryon_image_url: model.text().nullable(),
  /** Who the glasses are for: "me" | "other" (chosen in the try-on studio) */
  patient_for: model.text().nullable(),
  /** Name of the other person when patient_for = "other" — optional */
  patient_name: model.text().nullable(),
  /** "ai" when PD/fitting height came from the try-on AI measurement — null otherwise */
  measurement_source: model.text().nullable(),
  /** Quality level the AI reported for that measurement */
  measurement_quality: model.text().nullable(),
  /** Customer ID (Medusa customer) — nullable for guest checkout */
  customer_id: model.text().nullable(),
  /** "worn" (what the patient arrives wearing) or "new"; null = pre-POS rows, all "new" */
  kind: model.enum(["worn", "new"]).nullable(),
  /** Date written on the prescription, when known (for "months since last prescription") */
  rx_date: model.dateTime().nullable(),
  /** On a "new" row: the "worn" row it replaces */
  previous_prescription_id: model.text().nullable(),
});
