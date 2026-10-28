import { model } from "@medusajs/framework/utils";

/**
 * One price rule (src/lib/store-pricing.ts has the semantics).
 *
 *  - establishment_id null + mode "override": the owner's global price of a
 *    product (the base for the web and every store);
 *  - establishment_id set + scope "all": the store's general adjustment
 *    (percent, or a fixed "delta" added once per sale line);
 *  - establishment_id set + scope "frame"/"case": the store's exact price;
 *  - mode "min": minimum price (HU-16) — of a model's frame (scope
 *    "frame"/"case", dollars) or of every line as a % of its list (scope "all").
 *
 * Rows are never edited: a change closes the current row (valid_to) and adds a
 * new one, which is the price history. `value` is a percentage for "percent"
 * and dollars otherwise. Configuration, never purged.
 *
 * Not `price_rule`: that table and the `PriceRule` entity are Medusa Pricing's,
 * and reusing them breaks the migration and the boot (tests/model-names.test.ts).
 */
export const StorePriceRule = model.define("store_price_rule", {
  id: model.id({ prefix: "prr" }).primaryKey(),
  establishment_id: model.text().nullable(),
  scope: model.enum(["all", "frame", "case"]),
  /** Medusa product id for "frame"/"case" (prices are per model); null for "all". */
  target: model.text().nullable(),
  mode: model.enum(["percent", "delta", "override", "min"]),
  value: model.float(),
  valid_from: model.dateTime(),
  valid_to: model.dateTime().nullable(),
  source: model.text().nullable(),
  created_by: model.text().nullable(),
  closed_by: model.text().nullable(),
});
