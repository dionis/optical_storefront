import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { isMatrixSection, redactMatrixCosts, type MatrixResponse } from "../../../../lib/price-matrix";
import { loadMatrixSection } from "../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../lib/price-matrix-route";

/**
 * GET /admin/pricing/matrix?section=frames|cases|lenses|treatments[&q=]
 *
 * «Productos y precios»: one row per article, its cost and, per active store,
 * its price, why (`source`), whether the owner fixed it (`exact`), his
 * discount there (`discount_pct`), what the till charges (`final_cents`) and
 * whether the store sells it (`exposed`). Shape and semantics:
 * docs/PRICE-MATRIX.md. Built by lib/price-matrix-data.ts — five queries for
 * the whole frames section, whatever the number of models and stores.
 *
 * `q` filters by title, any colour's SKU or brand (frames / cases), by title
 * or key (lenses / treatments). Without «Ver costos» / «Gestionar costos» the
 * keys `cost_cents` / `cost_source` do not exist (removed on the server).
 *
 * Reasons: `bad_section` (422), `load_failed` (500).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = req.query as Record<string, unknown>;
  const section = query["section"] ?? "frames";
  if (!isMatrixSection(section)) {
    res.status(422).json({ type: "invalid_data", reason: "bad_section", message: "Unknown matrix section." });
    return;
  }
  const q = String(query["q"] ?? "").trim().slice(0, 80);
  try {
    const access = await matrixAccess(req);
    const started = Date.now();
    const { stores, groups } = await loadMatrixSection(req.scope, section, { q, withCosts: access.canSeeCosts });
    const body: MatrixResponse = {
      section,
      cost_access: access.canSeeCosts,
      stores,
      groups: redactMatrixCosts(groups, access.canSeeCosts),
    };
    logger.debug(`[price-matrix] ${section} q=${q || "-"}: ${groups.reduce((n, g) => n + g.rows.length, 0)} rows × ${stores.length} stores in ${Date.now() - started}ms`);
    res.json(body);
  } catch (error) {
    logger.error(`[price-matrix] ${section} load failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the price matrix." });
  }
}
