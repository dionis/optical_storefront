import { model } from "@medusajs/framework/utils";

/**
 * A till's cash register for a shift (HU-32). Expected cash = opening float +
 * cash payments recorded at that till (refunds negative) + cash in − cash out;
 * the difference with the count is recorded and alerts (cash.diff).
 * Order data: purged with the orders.
 */
export const CashSession = model.define("cash_session", {
  id: model.id({ prefix: "cash" }).primaryKey(),
  establishment_id: model.text(),
  terminal_id: model.text(),
  opened_by: model.text().nullable(),
  opened_at: model.dateTime(),
  opening_cents: model.number().default(0),
  closed_by: model.text().nullable(),
  closed_at: model.dateTime().nullable(),
  expected_cents: model.number().nullable(),
  counted_cents: model.number().nullable(),
  diff_cents: model.number().nullable(),
  note: model.text().nullable(),
});

/** Cash put in or taken out of the register (change float, a supplier paid in cash…). */
export const CashMovement = model.define("cash_movement", {
  id: model.id({ prefix: "cashm" }).primaryKey(),
  session_id: model.text(),
  kind: model.enum(["in", "out"]),
  amount_cents: model.number(),
  note: model.text().nullable(),
  created_by: model.text().nullable(),
});
