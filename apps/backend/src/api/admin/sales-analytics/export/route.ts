import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { analyticsFilter } from "../../../../lib/analytics-route";
import { listEstablishments } from "../../../../lib/establishments";
import { posHandler } from "../../../../lib/pos-route";
import { salesCsv } from "../../../../lib/sales-analytics";

/**
 * GET /admin/sales-analytics/export?… — what is filtered, line by line, as
 * CSV (HU-65). Opens in Excel and imports into Google Sheets as is.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { filter } = await analyticsFilter(req);
    const stores = new Map((await listEstablishments(req.scope)).map((s) => [s.id, `${s.code} ${s.name}`]));
    const csv = await salesCsv(req.scope, filter, (id, channel) => (channel === "web" ? "web" : stores.get(id ?? "") ?? id ?? ""));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sales_${filter.from}_${filter.to}.csv"`);
    // BOM so Excel reads the accents right (built, not typed: a literal one is invisible and fails lint).
    res.send(String.fromCharCode(0xfeff) + csv);
  });
}
