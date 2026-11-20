import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { categoryReport } from "../../../../lib/category-report";
import { financeScope } from "../../../../lib/finance-scope";
import { posHandler } from "../../../../lib/pos-route";

/**
 * GET /admin/finance/category-report?from=YYYY-MM-DD&to=YYYY-MM-DD&store=<id|web|all>&group=month|quarter|year
 *
 * The accounting report by category (lib/category-report.ts): the income
 * statement of the span plus what each line is made of — cost of goods by
 * concept, each cost item, each seller's commission — per period and per
 * store, in dollars. Same scope as the statement (lib/finance-scope.ts).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    res.json(await categoryReport(req.scope, await financeScope(req)));
  });
}
