import { model } from "@medusajs/framework/utils";

/**
 * One line of the owner's cost sheet template: "a frame of brand X costs me
 * A", "the lab charges B per order", "the gateway keeps C% of the total".
 *
 * `kind` says what the rule applies to and `match_key` which one (brand slug,
 * SKU, lens code, or a free label for per-order items). The pair is unique
 * among live rows — enforced in `src/lib/costing.ts`, not by the database, so
 * a soft-deleted rule frees its slot. `amount` is in the store currency
 * (`unit` = "fixed") or a percentage of the order total (`unit` = "percent").
 *
 * Configuration, not order data — never purged by purge-orders.
 */
export const CostRule = model.define("cost_rule", {
  id: model.id({ prefix: "crule" }).primaryKey(),
  kind: model.text(),
  match_key: model.text(),
  label: model.text(),
  amount: model.float().default(0),
  /** "fixed" | "percent" */
  unit: model.text().default("fixed"),
  active: model.boolean().default(true),
  sort_order: model.number().default(0),
  notes: model.text().nullable(),
});
