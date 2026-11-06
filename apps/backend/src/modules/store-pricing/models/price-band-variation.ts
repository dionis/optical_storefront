import { model } from "@medusajs/framework/utils";

/**
 * ONE STORE's own floor and ceiling, when it does not use the chain's.
 *
 * The same shape the panel already uses everywhere else — `store_frame_cost` +
 * `store_frame_cost_variation` for what a model costs, `lens_store_price` for
 * the lens matrix: a row exists ONLY where a store differs, «Todas las
 * tiendas» edits the master (`store_price_band`), and a store with no row of
 * its own inherits it and is badged «Heredado». Removing the row is how a store
 * goes back to inheriting.
 *
 * A variation REPLACES the master's band whole — it is not merged column by
 * column. "This store's floor is 40→70" has to be readable as one sentence; a
 * half-inherited band ("its floor, the chain's ceiling") is the kind of rule
 * nobody can hold in their head when a price looks wrong at the counter.
 *
 * Cents, integers, and the same two-numbers-per-side shape as the master.
 * Configuration — never purged with the orders.
 */
export const StorePriceBandVariation = model.define("store_price_band_variation", {
  id: model.id({ prefix: "prbv" }).primaryKey(),
  /** The store this band belongs to; one live row each (no master row here). */
  establishment_id: model.text(),
  floor_below_cents: model.number().nullable(),
  floor_to_cents: model.number().nullable(),
  cap_above_cents: model.number().nullable(),
  cap_to_cents: model.number().nullable(),
  apply_to_cases: model.boolean().default(false),
  enabled: model.boolean().default(true),
  updated_by: model.text().nullable(),
});
