import { model } from "@medusajs/framework/utils";

/**
 * A physical tray (bandeja) holding a sale's lenses: Op2-163. Taken when the
 * sale needs lab work, released when the glasses are delivered or the sale is
 * voided; the next sale gets the lowest free number of its store.
 */
export const PosTray = model.define("pos_tray", {
  id: model.id({ prefix: "postray" }).primaryKey(),
  establishment_id: model.text(),
  number: model.number(),
  sale_id: model.text(),
  assigned_at: model.dateTime(),
  released_at: model.dateTime().nullable(),
});
