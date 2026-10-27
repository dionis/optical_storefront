import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analyticsFilter } from "../../../../lib/analytics-route";
import { PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { BREAKDOWNS, salesBreakdown, type Breakdown } from "../../../../lib/sales-analytics";

/**
 * GET /admin/sales-analytics/breakdown?by=establishment|seller|product|brand|category|lens_design|lens_material|lens_photo|lens_ar|payment_method|terminal
 * Ranking with total, sales, units and share (HU-63, HU-66, HU-115), with the
 * same filters as the summary and the previous period when compare=1.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { filter } = await analyticsFilter(req);
    const by = String((req.query as Record<string, unknown>).by ?? "establishment");
    if (!(BREAKDOWNS as readonly string[]).includes(by)) throw new PosError("bad_breakdown");
    res.json({ by, rows: await salesBreakdown(req.scope, filter, by as Breakdown) });
  });
}
