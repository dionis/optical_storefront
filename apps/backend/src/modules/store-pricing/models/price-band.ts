import { model } from "@medusajs/framework/utils";

/**
 * The CHAIN's floor and ceiling for a selling price — the master every store
 * falls back to (`store_price_band_variation` is one store's own).
 *
 * The owner, in his words: «vamos a manejar la regla de que si el precio
 * después de conversión es menor que 30, podemos definir que se lleva hasta por
 * ejemplo 60, un número fijo. Si el precio después de conversión es muy alto,
 * también poder reducirlo hasta un monto que no sobrepase un umbral de, no sé,
 * 100 dólares. Esto se debe poder hacer, por ejemplo el dueño lo hace una vez
 * para todas las tiendas».
 *
 * So it is NOT one number per side but two: a THRESHOLD ("below $30") and a
 * TARGET ("sell it at $60"). A floor of 30→60 is not "raise everything under
 * $30 to $30": a frame the conversion prices at $8 is worth $60 on the shelf.
 *
 *  - `scope` exists only so there is exactly one live master row (always
 *    "chain", with a unique index on it): the band is chain-wide by design.
 *  - Each side is active only when BOTH of its columns are set, so the owner
 *    can define only the floor, only the ceiling, or both.
 *  - `enabled` false keeps the numbers and stops applying them — turning the
 *    band off must not make the owner retype it.
 *  - `apply_to_cases` is false by default ON PURPOSE: the conversion sells a
 *    $0.98 case at $5, and a 30→60 floor would put a plastic case on the shelf
 *    at $60. See `applyPriceBand` in src/lib/pricing.ts.
 *
 * Cents, integers: a float here is how a $59.99 becomes $59.98.
 * Configuration — never purged with the orders.
 */
export const StorePriceBand = model.define("store_price_band", {
  id: model.id({ prefix: "prbd" }).primaryKey(),
  /** Always "chain": one live master row, kept unique by the migration's index. */
  scope: model.text().default("chain"),
  /** Below this converted price the floor fires; null = no floor. */
  floor_below_cents: model.number().nullable(),
  /** What a price under the threshold becomes; null = no floor. */
  floor_to_cents: model.number().nullable(),
  /** Above this converted price the ceiling fires; null = no ceiling. */
  cap_above_cents: model.number().nullable(),
  /** What a price over the threshold becomes; null = no ceiling. */
  cap_to_cents: model.number().nullable(),
  /** Whether cases (estuches) get the band too. Default: they do NOT. */
  apply_to_cases: model.boolean().default(false),
  enabled: model.boolean().default(true),
  updated_by: model.text().nullable(),
});
