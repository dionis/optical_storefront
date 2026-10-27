import { model } from "@medusajs/framework/utils";

/**
 * One price rule (src/lib/store-pricing.ts has the semantics).
 *
 *  - establishment_id null + mode "override": the owner's global price of a
 *    product (the base for the web and every store);
 *  - establishment_id set + scope "all": the store's general adjustment
 *    (percent, or a fixed "delta" added once per sale line);
 *  - establishment_id set + scope "frame"/"case": the store's exact price.
 *
 * Rows are never edited: a change closes the current row (valid_to) and adds a
 * new one, which is the price history. `value` is a percentage for "percent"
 * and dollars otherwise. Configuration, never purged.
 */
export const PriceRule = model.define("price_rule", {
  id: model.id({ prefix: "prr" }).primaryKey(),
  establishment_id: model.text().nullable(),
  scope: model.enum(["all", "frame", "case"]),
  /** Medusa product id for "frame"/"case" (prices are per model); null for "all". */
  target: model.text().nullable(),
  mode: model.enum(["percent", "delta", "override"]),
  value: model.float(),
  valid_from: model.dateTime(),
  valid_to: model.dateTime().nullable(),
  source: model.text().nullable(),
  created_by: model.text().nullable(),
  closed_by: model.text().nullable(),
});
