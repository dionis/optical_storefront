import { model } from "@medusajs/framework/utils";

/**
 * The ledger of what a point-of-sale customer actually paid (Medusa records
 * the full order through the manual provider): deposits at the sale, balances
 * collected later, refunds on a void. A sale can be split across methods.
 */
export const PosSalePayment = model.define("pos_sale_payment", {
  id: model.id({ prefix: "pospay" }).primaryKey(),
  sale_id: model.text(),
  method_code: model.text(),
  amount_cents: model.number(),
  /** Card last digits, Zelle confirmation, insurance claim… — optional. */
  reference: model.text().nullable(),
  kind: model.enum(["deposit", "balance", "refund"]).default("deposit"),
  establishment_id: model.text().nullable(),
  received_by: model.text().nullable(),
  /** Processor fee at the time of the payment; later fee edits never change it. */
  fee_cents: model.number().default(0),
  counts_as_cash: model.boolean().default(false),
  /** Reference data asked by the method (last4, confirmation, tendered/change…). */
  details: model.json().nullable(),
  cash_session_id: model.text().nullable(),
});
