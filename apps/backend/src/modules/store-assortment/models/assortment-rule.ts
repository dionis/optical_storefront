import { model } from "@medusajs/framework/utils";

/**
 * What a store exposes for sale (src/lib/store-assortment.ts has the semantics).
 *
 * A new store sells the whole catalog (owner's decision): with no rows, every
 * published product is exposed. Rows are exceptions:
 *  - scope "brand" + target brand_slug: the whole brand, including models the
 *    scraper adds later;
 *  - scope "product" + target product id: one model, which beats its brand's
 *    rule (a model can stay on sale in a hidden brand, or the reverse).
 *
 * One row per (store, scope, target); removing it returns that brand or model to
 * what it inherits. Configuration, never purged.
 */
export const StoreAssortmentRule = model.define("store_assortment_rule", {
  id: model.id({ prefix: "asr" }).primaryKey(),
  establishment_id: model.text(),
  scope: model.enum(["brand", "product"]),
  target: model.text(),
  exposed: model.boolean(),
  created_by: model.text().nullable(),
});
