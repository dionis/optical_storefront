import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analyticsFilter } from "../../../../lib/analytics-route";
import { posHandler } from "../../../../lib/pos-route";
import { salesList } from "../../../../lib/sales-analytics";

/** GET /admin/sales-analytics/sales?…&page= — the sales behind a figure (HU-64). */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { filter } = await analyticsFilter(req);
    const page = Math.max(0, Number((req.query as Record<string, unknown>).page) || 0);
    const sales = await salesList(req.scope, filter, 100, page * 100);
    res.json({ sales, page, has_more: sales.length === 100 });
  });
}
