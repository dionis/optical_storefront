import { model } from "@medusajs/framework/utils";

/**
 * A till (punto de venta) of a store: Op2-POS1. Every sale records the till it
 * was made from (HU-86). Created by the owner, a superadmin or the store's
 * manager; never deleted, only deactivated (old sales point at it).
 */
export const PosTerminal = model.define("pos_terminal", {
  id: model.id({ prefix: "posterm" }).primaryKey(),
  establishment_id: model.text(),
  code: model.text(),
  name: model.text().nullable(),
  /** Language of the customer's receipt. */
  receipt_locale: model.text().default("es"),
  /** Language of the lab ticket's field names (English, like the current ticket). */
  ticket_locale: model.text().default("en"),
  printer: model.json().nullable(),
  is_active: model.boolean().default(true),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});
