import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { localParts } from "../../../../lib/alerts";
import { pnlBreakdown } from "../../../../lib/pnl-breakdown";
import { PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { costScope } from "../../../../lib/store-costs-route";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/store-costs/breakdown?month=YYYY-MM&store=<id>
 *
 * Where each figure of the month's result comes from (lib/pnl-breakdown.ts):
 * the parts of the net sales, the cost of goods, the payment fees by method,
 * each seller's commission and each cost item with what it charged. Without
 * `store`, every store the person may see. «Ver costos» or «Gestionar costos»,
 * like the result itself (/admin/store-costs/pnl).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { storeIds } = await costScope(req);
    const q = req.query as Record<string, string | undefined>;
    const month = q.month && /^\d{4}-\d{2}$/.test(q.month) ? q.month : localParts(new Date(), tenant().timezone).date.slice(0, 7);
    const store = q.store ? String(q.store).slice(0, 80) : null;
    if (storeIds !== null && !storeIds.length) throw new PosError("forbidden_store", 403);
    if (store && storeIds !== null && !storeIds.includes(store)) throw new PosError("forbidden_store", 403);
    res.setHeader("Cache-Control", "no-store");
    res.json(await pnlBreakdown(req.scope, month, storeIds, store));
  });
}
