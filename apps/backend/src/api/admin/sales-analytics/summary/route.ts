import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analyticsFilter } from "../../../../lib/analytics-route";
import { posHandler } from "../../../../lib/pos-route";
import { salesSummary } from "../../../../lib/sales-analytics";

/**
 * GET /admin/sales-analytics/summary?from=&to=&stores=&sellers=&products=&brands=&categories=&payment_methods=&lens_designs=&rx=
 * Sales, number of sales, average ticket, units, the previous period of the
 * same length, and what customers and insurers still owe (HU-60, HU-62).
 * Scoped to the caller (lib/analytics-route.ts).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { filter } = await analyticsFilter(req);
    res.json({ filter, ...(await salesSummary(req.scope, filter)) });
  });
}
