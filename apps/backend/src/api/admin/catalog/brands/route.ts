import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { catalogBrands } from "../../../../lib/price-matrix-data";

/**
 * GET /admin/catalog/brands → { brands: [{ slug, name, models }] }
 *
 * Every brand of the catalogue (published and draft models, by
 * `metadata.brand_slug`) with its number of models, plus the known brands
 * that have none yet — the list «Añadir montura» picks from. Sorted by name.
 * Owner and superadmin: `/admin/catalog/*` is not in the restricted roles'
 * allow-list (lib/staff-roles.ts). Reasons: `load_failed`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    res.json({ brands: await catalogBrands(req.scope) });
  } catch (error) {
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[catalog] brands failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the brands." });
  }
}
