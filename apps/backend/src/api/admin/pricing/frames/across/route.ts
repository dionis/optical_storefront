import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../../../lib/establishments";
import { frameCostsDenied } from "../../../../../lib/frame-cost-route";
import { ACROSS_LIMIT, ACROSS_MIN_QUERY, loadPricingAcross, redactAcrossCosts } from "../../../../../lib/pricing-across";

/**
 * GET /admin/pricing/frames/across?q=<text or SKU>
 *
 * HU-13: ONE model, its price in EVERY active store. Up to `ACROSS_LIMIT`
 * published models whose title or any colour's SKU contains `q`:
 *
 *   {
 *     q, limit, truncated,
 *     cost_access,
 *     stores: [{ id, code, name, color }],
 *     rows: [{ product_id, title, brand, thumbnail, sku, skus, is_case,
 *              base_cents, master_price_cents, master_source,
 *              cost_cents?,                       // cost viewers only
 *              stores: [{ establishment_id, code, name, color,
 *                         price_cents, source, exposed, cost_cents? }] }]
 *   }
 *
 * Each store cell is `storeLinePrice` — the till's function — and the master
 * cell is `catalogSellingPrices`, so the figures are the ones the receipt and
 * the costs tab show (lib/pricing-across.ts). `source` says what produced the
 * figure (`exact` | `band` | `adjusted` | `base`) and `exposed` whether the
 * store sells the model at all (store-assortment).
 *
 * Owner and superadmin only: `/admin/pricing/*` has no allow-list entry in
 * lib/staff-roles.ts, so lib/staff-guard.ts refuses every other role before
 * this runs — the same deny-by-default as the sibling routes. The cost
 * (`cost_cents`, master and per store) leaves only with «Ver costos» /
 * «Gestionar costos», the same check `frames/costs` makes; for anyone else it
 * is removed on the server (`redactAcrossCosts`). Reasons: `load_failed`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const q = String((req.query as Record<string, unknown>)["q"] ?? "").trim().slice(0, 80);
  try {
    const [stores, costDenied] = await Promise.all([listEstablishments(req.scope), frameCostsDenied(req, "read")]);
    const withCosts = costDenied === null;
    if (q.length < ACROSS_MIN_QUERY) {
      res.json({
        q,
        limit: ACROSS_LIMIT,
        truncated: false,
        cost_access: withCosts,
        stores: stores.filter((s) => s.is_active).map((s) => ({ id: s.id, code: s.code, name: s.name, color: s.color })),
        rows: [],
      });
      return;
    }
    const { rows, stores: active } = await loadPricingAcross(req.scope, { q, stores, withCosts });
    res.json({
      q,
      limit: ACROSS_LIMIT,
      truncated: rows.length >= ACROSS_LIMIT,
      cost_access: withCosts,
      stores: active,
      rows: redactAcrossCosts(rows, withCosts),
    });
  } catch (error) {
    logger.error(`[pricing] across-stores view failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the prices across stores." });
  }
}
