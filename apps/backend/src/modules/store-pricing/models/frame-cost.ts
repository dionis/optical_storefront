import { model } from "@medusajs/framework/utils";

/**
 * What the shop PAYS for one frame or case model — the supplier's own figure,
 * so every margin in the panel starts from a real number instead of a cost
 * rule the owner once typed. Seeded from Capri Optics' "Discount Price List
 * July 2026" (`../capri-price-list-2026.ts`, 609 rows) and editable model by
 * model from Commercial › Prices and costs.
 *
 *  - `sku` is the NORMALISED key (A-Z0-9 only, `capriKeyOf`), because the
 *    catalogue writes "ML 8" where the supplier prints "ML8" and both have to
 *    land on the same row. One live row per key.
 *  - `supplier_model` is the model exactly as the supplier prints it
 *    ("CASE SC-2 W/CLIP") — kept so the owner recognises the row in a list
 *    that is otherwise normalised beyond reading. Not called `model`: that is
 *    the name of Medusa's own model builder in every file that touches this.
 *  - `book_cents` is the supplier's catalogue ("book") price and `cost_cents`
 *    what we actually pay. Only `cost_cents` feeds a margin.
 *  - `source` says WHERE the figure comes from, and it is the whole safety
 *    rule of this table: "supplier_list" rows are rewritten whenever a new
 *    list is loaded (or the seeding migration runs again), "owner_edit" rows
 *    NEVER are. Without that distinction the next deploy would quietly undo
 *    the owner's own accounting.
 *  - `updated_by` + `updated_at` (Medusa's own column): who moved the figure
 *    and when, which is what makes an edited cost auditable next to the
 *    `cost.change` audit event.
 *
 * Configuration — never purged with the orders.
 */
export const StoreFrameCost = model.define("store_frame_cost", {
  id: model.id({ prefix: "frc" }).primaryKey(),
  /** Normalised SKU key (A-Z0-9), unique among live rows. */
  sku: model.text().unique(),
  /** Model as the supplier prints it. */
  supplier_model: model.text(),
  book_cents: model.number().default(0),
  cost_cents: model.number().default(0),
  // `supplier_list_prev` (v2): the previous supplier list, when the 2026 one lacks the model.
  source: model.enum(["supplier_list", "supplier_list_prev", "owner_edit"]).default("supplier_list"),
  updated_by: model.text().nullable(),
});
