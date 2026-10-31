import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analyticsFilter } from "../../../../lib/analytics-route";
import { posHandler } from "../../../../lib/pos-route";
import { salesList } from "../../../../lib/sales-analytics";
import { attachSaleEconomics, insightAccess, orderEconomics } from "../../../../lib/sales-insights";

/**
 * GET /admin/sales-analytics/sales?…&page= — the sales behind a figure (HU-64),
 * each with what it collected and still owes (`paid`, `balance`) and its money
 * for the store: `cost` (frame, lens and per-order fixed rules), `fee` (the
 * payment's), `commission` (the seller's), `profit`, `margin_pct` and
 * `missing_cost`, added up from the same per-line economics as the panel.
 * Cost, fee, profit and margin come back null unless the caller may see the
 * store's profit (insightAccess: admins, costs.view, costs.manage); the
 * commission also for a seller over their own sales. `access` says which.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { filter, scope } = await analyticsFilter(req);
    const page = Math.max(0, Number((req.query as Record<string, unknown>).page) || 0);
    const access = insightAccess(scope);
    const rows = await salesList(req.scope, filter, 100, page * 100);
    const econ = access.profit || access.commission ? await orderEconomics(req.scope, filter, rows.map((r) => r.order_id)) : new Map();
    res.json({ access, sales: attachSaleEconomics(rows, econ, access), page, has_more: rows.length === 100 });
  });
}
