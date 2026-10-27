import { model } from "@medusajs/framework/utils";

/**
 * The part of a sale an insurer covers (HU-113): owed by the insurer, not the
 * customer, and pending until the owner marks it paid (HU-114).
 *
 * Member and authorization numbers are treated like health data: never on
 * receipts, alerts or Google Sheets.
 */
export const InsuranceClaim = model.define("insurance_claim", {
  id: model.id({ prefix: "insc" }).primaryKey(),
  sale_id: model.text(),
  order_id: model.text().nullable(),
  establishment_id: model.text(),
  payer_name: model.text(),
  member_id: model.text().nullable(),
  authorization_no: model.text().nullable(),
  covered_cents: model.number(),
  status: model.enum(["pending", "submitted", "paid", "rejected"]).default("pending"),
  paid_cents: model.number().nullable(),
  paid_at: model.dateTime().nullable(),
  note: model.text().nullable(),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});
