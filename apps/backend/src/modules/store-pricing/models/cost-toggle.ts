import { model } from "@medusajs/framework/utils";

/**
 * Per-store ON/OFF of a cost (pricing panel, "Costos" → each rule with its
 * switch). The owner's requirement: "each store can also enable/disable costs".
 *
 *  - `ref_kind` "rule" → a `cost_rule` row (the cost-sheet template);
 *    "cost" → a `cost_item` row (the store's fixed / variable costs).
 *  - `ref_id` is that row's id (for a cost rule the panel sends
 *    "<kind>:<match_key>" when the row has no id yet, which is also what
 *    `lib/costing.ts` uses as a line key).
 *  - Absence means ENABLED: a store with no rows behaves exactly as before.
 *
 * Nothing is deleted on a change: the row is updated, so the audit log carries
 * the before and after (`cost.toggle`). Configuration — never purged.
 */
export const StoreCostToggle = model.define("store_cost_toggle", {
  id: model.id({ prefix: "ctg" }).primaryKey(),
  establishment_id: model.text(),
  /** "rule" | "cost" */
  ref_kind: model.text(),
  ref_id: model.text(),
  enabled: model.boolean().default(true),
  created_by: model.text().nullable(),
});

/**
 * One number the pricing panel owns and no other table has a home for: today
 * only `default_commission_pct` (the seller commission a new seller starts
 * with, shown in the panel's "Comisiones" section). A key/value row rather
 * than a column on `store_setting` so the panel can add its own settings
 * without a migration on a table three other screens write.
 */
export const PricingSetting = model.define("store_pricing_setting", {
  id: model.id().primaryKey(),
  key: model.text().unique(),
  value: model.float().default(0),
  updated_by: model.text().nullable(),
});
