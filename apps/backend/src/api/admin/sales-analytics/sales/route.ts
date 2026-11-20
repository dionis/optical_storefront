import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analyticsFilter } from "../../../../lib/analytics-route";
import { posHandler } from "../../../../lib/pos-route";
import { salesList, salesListCount, salesPageSize } from "../../../../lib/sales-analytics";
import { attachSaleEconomics, insightAccess, orderEconomics } from "../../../../lib/sales-insights";

/**
 * GET /admin/sales-analytics/sales?…&page=&limit= — the sales behind a figure
 * (HU-64), each with what it collected and still owes (`paid`, `balance`) and
 * its money for the store: `cost` (frame, lens and per-order fixed rules),
 * `fee` (the payment's), `commission` (the seller's), `profit`, `margin_pct`
 * and `missing_cost`, added up from the same per-line economics as the panel.
 * Cost, fee, profit and margin come back null unless the caller may see the
 * store's profit (insightAccess: admins, costs.view, costs.manage); the
 * commission also for a seller over their own sales. `access` says which.
 * Each row also describes the sale for the printed reports: `frame_brand`,
 * `frame_model`, `frame_color`, `frame_sku`, `own_frame`, `has_rx`, `lens`
 * (codes) and `lens_summary` ({es, en} labels), plus `customer_phone`.
 *
 * The response says `limit` and `total` as well as `page`, so a client that
 * wants the whole period can ask for its pages at once rather than walking
 * them one at a time waiting to see a short one. `total` is one cheap
 * COUNT(DISTINCT order_id) over the same filter (salesListCount), the figure
 * the summary already computes, not an estimate.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { filter, scope } = await analyticsFilter(req);
    const q = req.query as Record<string, unknown>;
    const page = Math.max(0, Number(q.page) || 0);
    const limit = salesPageSize(q.limit);
    const access = insightAccess(scope);
    const [rows, total] = await Promise.all([salesList(req.scope, filter, limit, page * limit), salesListCount(req.scope, filter)]);
    const econ = access.profit || access.commission ? await orderEconomics(req.scope, filter, rows.map((r) => r.order_id)) : new Map();
    // Both halves are an end-of-list signal on their own; asking for both keeps
    // a client out of an endless loop if ever the count and the page disagree.
    res.json({ access, sales: attachSaleEconomics(rows, econ, access), page, limit, total, has_more: rows.length === limit && (page + 1) * limit < total });
  });
}
