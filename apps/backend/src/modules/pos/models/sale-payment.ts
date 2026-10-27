import { model } from "@medusajs/framework/utils";

/** One payment of a point-of-sale sale; a sale can be split across methods. */
export const PosSalePayment = model.define("pos_sale_payment", {
  id: model.id({ prefix: "pospay" }).primaryKey(),
  sale_id: model.text(),
  method_code: model.text(),
  amount_cents: model.number(),
  /** Card last digits, Zelle confirmation, insurance claim… — optional. */
  reference: model.text().nullable(),
});
