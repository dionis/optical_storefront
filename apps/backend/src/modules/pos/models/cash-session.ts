import { model } from "@medusajs/framework/utils";

/**
 * The STORE's cash register for a shift (HU-32, owner's rule of 2026-11:
 * "opening and closing are for the whole store, not for one till"). One open
 * session per establishment (partial unique index in CreatePos5); the first
 * cash payment of the day opens it on its own when nobody did.
 *
 * The ledger is `cash_movement` (lib/cash.ts): every cash payment, refund and
 * manual in/out is one row, so expected = opening + Σ in − Σ out. The count,
 * the difference and the initials of whoever closed are recorded here; a
 * difference leaves the session `pending_approval` until the owner signs it.
 * Order data: purged with the orders.
 */
export const CashSession = model.define("cash_session", {
  id: model.id({ prefix: "cash" }).primaryKey(),
  establishment_id: model.text(),
  /** Till of the sessions from before the store-level register; null since then. */
  terminal_id: model.text().nullable(),
  opened_by: model.text().nullable(),
  opened_at: model.dateTime(),
  opening_cents: model.number().default(0),
  /** Initials of whoever opened ("auto" openings carry the receiver's). */
  opened_signature: model.text().nullable(),
  opening_note: model.text().nullable(),
  closed_by: model.text().nullable(),
  closed_at: model.dateTime().nullable(),
  closed_signature: model.text().nullable(),
  expected_cents: model.number().nullable(),
  counted_cents: model.number().nullable(),
  diff_cents: model.number().nullable(),
  note: model.text().nullable(),
  status: model.enum(["open", "closed", "pending_approval"]).default("open"),
  /** Owner's (or superadmin's) initials authorising a difference. */
  approval_signature: model.text().nullable(),
  approved_by: model.text().nullable(),
  approved_at: model.dateTime().nullable(),
});

/**
 * One line of the register's ledger: a cash payment (`sale_payment`), a cash
 * refund (`sale_refund`), the opening float (`opening_float`) or cash put in /
 * taken out by hand (CASH_CATEGORIES in lib/cash.ts). Rows from before the
 * category column have none.
 */
export const CashMovement = model.define("cash_movement", {
  id: model.id({ prefix: "cashm" }).primaryKey(),
  session_id: model.text(),
  kind: model.enum(["in", "out"]),
  amount_cents: model.number(),
  category: model.text().nullable(),
  note: model.text().nullable(),
  created_by: model.text().nullable(),
  /** Set on the automatic lines: which sale and which ledger payment produced them. */
  sale_id: model.text().nullable(),
  payment_id: model.text().nullable(),
  /** The till the money went through (payments) or was declared at (manual). */
  terminal_id: model.text().nullable(),
});
