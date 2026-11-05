import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { loadLensMatrix } from "../../../../lib/lens-matrix";

/**
 * GET /store/lens-config/matrix
 * The full editable 2026 price list (designs × materials base matrix + photochromic
 * + AR options) that drives the storefront lens wizard. Read-only; the total is
 * always recomputed server-side via /store/lens-config/quote.
 *
 * Master prices only (a shopper has no store). The point of sale reads the same
 * payload, with its store's variations, from GET /admin/pos/lens-matrix. Both
 * are built by lib/lens-matrix.ts, which never lets `cost_cents` through.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  res.json(await loadLensMatrix(pg));
}
