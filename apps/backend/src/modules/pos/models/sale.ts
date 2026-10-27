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
});
