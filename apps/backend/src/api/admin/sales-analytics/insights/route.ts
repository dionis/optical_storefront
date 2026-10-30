import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analyticsFilter } from "../../../../lib/analytics-route";
import { PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { BREAKDOWNS, type Breakdown } from "../../../../lib/sales-analytics";
import { GRAINS, grainFor, MAX_RANGE_DAYS, redactInsights, salesInsights, spanDays, type Grain } from "../../../../lib/sales-insights";
import { hasPrivilege } from "../../../../lib/staff-profile";

/**
 * GET /admin/sales-analytics/insights?grain=hour|day|month|year&by=establishment|seller|product|…
 * plus the filters of the summary. Sales and profit over time and by
 * dimension. Without `grain`, the one that suits the range. Profit and
 * commissions leave only for those who may see them (redactInsights), and
 * `access` tells the panel which ones they are.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { filter, scope } = await analyticsFilter(req);
    if (spanDays(filter.from, filter.to) > MAX_RANGE_DAYS) throw new PosError("bad_range");
    const q = req.query as Record<string, unknown>;
    const by = String(q.by ?? "establishment");
    if (!(BREAKDOWNS as readonly string[]).includes(by)) throw new PosError("bad_breakdown");
    const grain = (GRAINS as readonly string[]).includes(String(q.grain)) ? (q.grain as Grain) : grainFor(filter.from, filter.to);
    const profit = hasPrivilege(scope, "costs.view") || hasPrivilege(scope, "costs.manage");
    const access = { profit, commission: profit || scope.role === "seller", role: scope.role };
    res.json({ access, filter: { from: filter.from, to: filter.to }, ...redactInsights(await salesInsights(req.scope, filter, grain, by as Breakdown), access) });
  });
}
