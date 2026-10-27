import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analyticsFilter } from "../../../../lib/analytics-route";
import { posHandler } from "../../../../lib/pos-route";
import { previousPeriod, salesTimeseries } from "../../../../lib/sales-analytics";

/**
 * GET /admin/sales-analytics/timeseries?by_store=1 — sales per local day, and
 * the previous period for comparison (HU-62).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { filter } = await analyticsFilter(req);
    const byStore = (req.query as Record<string, unknown>).by_store === "1";
    const prev = previousPeriod(filter.from, filter.to);
    const [current, previous] = await Promise.all([
      salesTimeseries(req.scope, filter, byStore),
      salesTimeseries(req.scope, { ...filter, ...prev }, false),
    ]);
    res.json({ current, previous });
  });
}
