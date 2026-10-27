import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { localParts } from "../../../../lib/alerts";
import { PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { costScope } from "../../../../lib/store-costs-route";
import { monthPnl } from "../../../../lib/store-pnl";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/store-costs/pnl?month=YYYY-MM — result of each store and break-even
 * (HU-96), commissions per seller (HU-34) and the settlement with non-own
 * stores (HU-33). With «Ver costos» or «Gestionar costos».
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { storeIds } = await costScope(req);
    const q = req.query as Record<string, string | undefined>;
    const month = q.month && /^\d{4}-\d{2}$/.test(q.month) ? q.month : localParts(new Date(), tenant().timezone).date.slice(0, 7);
    if (storeIds !== null && !storeIds.length) throw new PosError("forbidden_store", 403);
    res.json(await monthPnl(req.scope, month, storeIds));
  });
}
