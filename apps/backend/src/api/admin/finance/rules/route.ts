import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { financeRules } from "../../../../lib/finance-rules";
import { PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { resolvePricingStore } from "../../../../lib/pricing-overview";
import { costScope } from "../../../../lib/store-costs-route";

/**
 * GET /admin/finance/rules?store=<id|all>
 *
 * Everything «Productos y precios → Reglas y comisiones» shows in its
 * accordions: store costs with their monthly normalisation, per-sale cost
 * rules (with that store's «Se cobra» switch when a store is chosen),
 * commissions and the default, the sales-tax rate and this month's store
 * result for the indicators. Owner / superadmin (the /admin/pricing area).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { storeIds } = await costScope(req);
    const store = await resolvePricingStore(req.scope, (req.query as Record<string, unknown>).store);
    if ("reason" in store) throw new PosError(store.reason, 404);
    res.json(await financeRules(req.scope, store.storeId, storeIds));
  });
}
