import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";

/**
 * GET /store/lens-config/matrix
 * The full editable 2026 price list (designs × materials base matrix + photochromic
 * + AR options) that drives the storefront lens wizard. Read-only; the total is
 * always recomputed server-side via /store/lens-config/quote.
 *
 * Reads via the shared Postgres connection (Knex) rather than the module service,
 * which keeps this independent of the lens-config module's ORM manager lifecycle.
 *
 * `base_prices` rows carry `finish` ("stock" | "digital", lib/lens-finish.ts)
 * and are selected column by column on purpose: the table also holds the lab's
 * `cost_cents`, which is internal and must NEVER reach this public route.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

  // lens_treatment_price puede no existir todavía (antes de su migración); si la
  // consulta falla, devolvemos [] para que el storefront use su tabla de respaldo.
  const treatmentPrices = pg("lens_treatment_price").whereNull("deleted_at").catch(() => []);

  const [designs, materials, base_prices, photos, ars, treatment_prices] = await Promise.all([
    pg("lens_design").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_material").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_base_price")
      .whereNull("deleted_at")
      .select("design_code", "material_code", "finish", "price_cents")
      // Before the finish migration the column is missing: same rows, no finish.
      .catch(() => pg("lens_base_price").whereNull("deleted_at").select("design_code", "material_code", "price_cents")),
    pg("lens_photo_option").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_ar_option").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    treatmentPrices,
  ]);

  res.json({ designs, materials, base_prices, photos, ars, treatment_prices });
}
