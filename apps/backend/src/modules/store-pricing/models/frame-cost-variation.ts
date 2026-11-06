import { model } from "@medusajs/framework/utils";

/**
 * What ONE STORE pays for a frame or case model, when it does not pay what the
 * chain pays.
 *
 * The owner, in his words: «los costos se aplican a todas las tiendas, pero
 * cada tienda maneja sus costos por separado». The first half is
 * `store_frame_cost` (the master: the supplier's list, or the figure the owner
 * typed over it). This table is the second half, and it is the SAME shape the
 * panel already uses for prices (`lens_store_price`, the per-store variation
 * of the master lens list): a row exists only where a store differs, and a
 * model with no row inherits the master and is badged «Heredado».
 *
 *  - `establishment_id` is the store; there is no "master" row here — the
 *    master lives in `store_frame_cost`, so a NULL store would be a second
 *    place to write the same figure.
 *  - `sku` is the same NORMALISED key as the master (A-Z0-9, `frameCostKeyOf`),
 *    because the catalogue writes "ML 8" where the supplier prints "ML8" and a
 *    variation has to land on the very model the cost sheet reads.
 *  - `cost_cents` is what THIS store pays. One live row per (store, sku);
 *    removing the row is how a store goes back to inheriting, which is why
 *    there is no `source` column: the row's mere existence IS the variation.
 *  - `updated_by` + `updated_at` (Medusa's own column): who moved the figure
 *    and when, next to the `cost.change` audit event that carries the store.
 *
 * Configuration — never purged with the orders.
 */
export const StoreFrameCostVariation = model.define("store_frame_cost_variation", {
  id: model.id({ prefix: "frcv" }).primaryKey(),
  /** The store this figure belongs to. */
  establishment_id: model.text(),
  /** Normalised SKU key (A-Z0-9), unique per store among live rows. */
  sku: model.text(),
  /** What this store pays, in cents. The only figure its margins use. */
  cost_cents: model.number().default(0),
  updated_by: model.text().nullable(),
});
