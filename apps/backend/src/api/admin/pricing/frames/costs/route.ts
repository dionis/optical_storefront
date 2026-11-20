import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  catalogSellingPrices,
  frameCostStoreRows,
  frameCostStoreView,
  indexFrameCostVariations,
  listFrameCostVariations,
  listFrameCosts,
  loadCatalogModels,
  summarizeFrameCosts,
  withCatalogPrice,
} from "../../../../../lib/frame-cost";
import { frameCostsDenied } from "../../../../../lib/frame-cost-route";
import { resolvePricingStore } from "../../../../../lib/pricing-overview";
import { openRules } from "../../../../../lib/store-pricing-data";

/**
 * GET /admin/pricing/frames/costs[?store=<establishment id>]
 *
 * EVERY model's cost in one response (~600 rows, ~50 KB): the panel caches it
 * and joins it to the catalogue by SKU, which is cheaper than one request per
 * model and is what makes "cost and price in every commercial view" affordable.
 *
 * `store` reads exactly like the rest of the pricing panel (see
 * lib/pricing-overview.ts): absent / "all" / "web" is THE MASTER — the chain's
 * cost — and a real establishment id is that store's view, where every row
 * carries the figure THAT store pays and the master's next to it, so the panel
 * can show both and badge the inherited ones.
 *
 *   {
 *     store: <id> | null,
 *     costs: [{ sku, model, book_cents, cost_cents, origin, source,
 *               master_cost_cents, inherited, updated_at,
 *               price_cents, product_id, price_source }],
 *     summary: { rows, supplier_rows, owner_edited, store_variations,
 *                catalog_models, with_cost, without_cost,
 *                missing: [{ sku, title, brand_slug }] }
 *   }
 *
 * `cost_cents` is what the asked scope pays. `origin` says which layer answered
 * — "store_variation" (this store's own figure), "owner_edit" (the owner typed
 * the chain's) or "supplier_list" (the supplier's) — while `source` keeps
 * describing the MASTER, so a store's variation never re-labels where the
 * chain's figure came from. `inherited` is true when a store was asked about
 * and has nothing of its own: that row is the master's, and the panel says so.
 *
 * `price_cents` is the model's CURRENT selling price for the same scope (the
 * store's, or the chain's with no store — `catalogSellingPrices`, the figure
 * the catalogue card and the till use), with its `product_id` and
 * `price_source` (a store: exact / band / adjusted / base; the master: owner /
 * band / rule — the chain's general rule — / base); null when the catalogue
 * has no price for that key. Cost and price on one row is what lets the costs
 * tab say the margin per model. Appended after the nine fields above.
 *
 * `summary` answers the question the owner actually asks — how much of the
 * catalogue has a real cost FOR THIS STORE: `with_cost` + `without_cost` =
 * `catalog_models`, and the models in `without_cost` are the ones whose margin
 * reads as unknown (never as 100 %). With no database behind the catalogue the
 * counts are 0 and the list of costs still comes back.
 *
 * Read with «Ver costos» or «Gestionar costos» (admins hold both implicitly).
 * Reasons: `forbidden_role`, `store_not_found`, `load_failed`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const denied = await frameCostsDenied(req, "read");
  if (denied) {
    res.status(403).json({ type: "not_allowed", reason: denied, message: "Costs are not visible for this user." });
    return;
  }
  try {
    const scope = await resolvePricingStore(req.scope, (req.query as Record<string, unknown>)["store"]);
    if ("reason" in scope) {
      res.status(422).json({ type: "invalid_data", reason: scope.reason, message: "Unknown store." });
      return;
    }
    const storeId = scope.storeId;
    // Only the asked store's variations: the panel reads one store at a time.
    // (The process cache that the cost sheets read warms EVERY store's in one
    // pass — see `ensureFrameCostCache` — because a sheet is computed per order
    // and each order belongs to a different store.) A missing table is "no
    // store varies anything yet", which is the master, never a zero.
    const [costs, catalog, variations, rules] = await Promise.all([
      listFrameCosts(req.scope),
      loadCatalogModels(req.scope),
      listFrameCostVariations(req.scope, storeId).catch(() => []),
      // The price rules the catalogue is sold under; without them the prices
      // are the Medusa base, which is still a price and not a failure.
      openRules(req.scope, storeId ? [storeId] : []).catch(() => []),
    ]);
    const index = indexFrameCostVariations(variations);
    // Joined by the key each model's COST lives under (model first — v2), so a
    // model whose SKUs are slug-like still shows its price next to its cost.
    const prices = catalogSellingPrices(catalog, rules, storeId, new Date(), new Map(costs.map((c) => [c.sku, c])));
    res.json({
      store: storeId,
      costs: withCatalogPrice(frameCostStoreRows(costs, index, storeId).map(frameCostStoreView), prices),
      summary: summarizeFrameCosts(costs, catalog, index, storeId),
    });
  } catch (error) {
    logger.error(`[pricing] frame costs unavailable: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the frame costs." });
  }
}
