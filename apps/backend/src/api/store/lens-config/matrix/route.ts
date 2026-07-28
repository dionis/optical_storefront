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
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

  const [designs, materials, base_prices, photos, ars] = await Promise.all([
    pg("lens_design").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_material").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_base_price").whereNull("deleted_at"),
    pg("lens_photo_option").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_ar_option").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
  ]);

  res.json({ designs, materials, base_prices, photos, ars });
}
