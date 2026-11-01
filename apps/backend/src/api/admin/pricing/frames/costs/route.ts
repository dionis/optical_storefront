import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { frameCostView, listFrameCosts, loadCatalogModels, summarizeFrameCosts } from "../../../../../lib/frame-cost";
import { frameCostsDenied } from "../../../../../lib/frame-cost-route";

/**
 * GET /admin/pricing/frames/costs
 *
 * EVERY row of `store_frame_cost` in one response (~600 rows, ~40 KB): the
 * panel caches it and joins it to the catalogue by SKU, which is cheaper than
 * one request per model and is what makes "cost and price in every commercial
 * view" affordable.
 *
 *   {
 *     costs: [{ sku, model, book_cents, cost_cents, source, updated_at }],
 *     summary: { rows, supplier_rows, owner_edited,
 *                catalog_models, with_cost, without_cost, missing: [{ sku, title, brand_slug }] }
 *   }
 *
 * `source` is "supplier_list" (the figure is the supplier's) or "owner_edit"
 * (the owner typed it, and no list ever overwrites it). `updated_at` is the
 * last change, null for a row still untouched since the seed.
 *
 * `summary` answers the question the owner actually asks — how much of the
 * catalogue has a real cost: `with_cost` + `without_cost` = `catalog_models`,
 * and the models in `without_cost` are the ones whose margin reads as unknown
 * (never as 100 %). With no database behind the catalogue the counts are 0 and
 * the list of costs still comes back.
 *
 * Read with «Ver costos» or «Gestionar costos» (admins hold both implicitly).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const denied = await frameCostsDenied(req, "read");
  if (denied) {
    res.status(403).json({ type: "not_allowed", reason: denied, message: "Costs are not visible for this user." });
    return;
  }
  try {
    const [costs, catalog] = await Promise.all([listFrameCosts(req.scope), loadCatalogModels(req.scope)]);
    res.json({ costs: costs.map(frameCostView), summary: summarizeFrameCosts(costs, catalog) });
  } catch (error) {
    logger.error(`[pricing] frame costs unavailable: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the frame costs." });
  }
}
