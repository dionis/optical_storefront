import { model } from "@medusajs/framework/utils";

/**
 * A point-of-sale sale. The sale itself is a regular Medusa order (placed in
 * the store's sales channel, so the order board, emails, lab stages and Sheet
 * work as for the web); this row adds what Medusa does not model: the store's
 * own sale number, who sold it, and how it was paid (pos_sale_payment).
 *
 * `number` is `<store code>-<6-digit sequence>` (Op2-000147), one sequence per
 * store (pos_sale_counter), assigned only once the order exists so a failed
 * sale never burns a number. Amounts in cents.
 *
 * Order data: emptied by purge-orders together with the orders.
 */
export const PosSale = model.define("pos_sale", {
  id: model.id({ prefix: "poss" }).primaryKey(),
  number: model.text(),
  establishment_id: model.text(),
  seq: model.number(),
  seller_id: model.text().nullable(),
  order_id: model.text().nullable(),
  cart_id: model.text().nullable(),
  customer_id: model.text().nullable(),
  total_cents: model.number(),
  currency_code: model.text().default("usd"),
  status: model.enum(["completed", "voided"]).default("completed"),
  /** Private-bucket keys of the photos of frames the customer brought. */
  own_frame_photo_keys: model.json().nullable(),
  terminal_id: model.text().nullable(),
  /** Snapshot of the seller code printed on the documents. */
  seller_code: model.text().nullable(),
  /** Sent by the till so a retried request never records the sale twice. */
  idempotency_key: model.text().nullable(),
  /** Price list total before the discount. */
  list_cents: model.number().nullable(),
  discount_cents: model.number().default(0),
  discount_pct: model.float().default(0),
  discount_approval_id: model.text().nullable(),
  /** Paid by the customer (deposits + balances − refunds). */
  paid_cents: model.number().default(0),
  /** Covered by an insurer: owed by the insurer, not by the customer. */
  insurance_cents: model.number().default(0),
  /** What the customer still owes: total − paid − insurance. */
  balance_cents: model.number().default(0),
  tray_number: model.number().nullable(),
  /** YYYY-MM-DD the glasses are promised for. */
  promised_on: model.text().nullable(),
  delivery: model.enum(["pickup", "ship"]).default("pickup"),
  delivered_at: model.dateTime().nullable(),
  voided_at: model.dateTime().nullable(),
  voided_by: model.text().nullable(),
  void_reason: model.text().nullable(),
  void_note: model.text().nullable(),
  void_requested_by: model.text().nullable(),
  void_requested_at: model.dateTime().nullable(),
  /** Free text the staff keep on the sale (never printed on the customer's receipt). */
  internal_note: model.text().nullable(),
  /** Last edit of the sale's details (lib/pos-sale-admin.ts updateSaleDetails). */
  edited_at: model.dateTime().nullable(),
  edited_by: model.text().nullable(),
  /**
   * Soft delete by an owner or superadmin (lib/pos-sale-admin.ts deleteSale):
   * `deleted_at` (Medusa's own column) hides the sale everywhere; these say who
   * and why, so it can be restored.
   */
  deleted_by: model.text().nullable(),
  delete_reason: model.text().nullable(),
  /**
   * Numbers the sale had before being moved to another store, oldest first:
   * [{ number, establishment_id, moved_at, moved_by }] (lib/pos-sale-admin.ts moveSale).
   */
  previous_numbers: model.json().nullable(),
  /**
   * The patient wearing the frame, taken at the counter and shown at pickup
   * (lib/pos-wearing-photo.ts). The key never leaves the backend.
   */
  wearing_photo_key: model.text().nullable(),
  wearing_photo_at: model.dateTime().nullable(),
  wearing_photo_by: model.text().nullable(),
  wearing_photo_consent_at: model.dateTime().nullable(),
});
