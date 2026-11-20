import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { financeScope } from "../../../../lib/finance-scope";
import { financialStatement, statementDollars } from "../../../../lib/financial-statement";
import { posHandler } from "../../../../lib/pos-route";

/**
 * GET /admin/finance/statement?from=YYYY-MM-DD&to=YYYY-MM-DD&store=<id|web|all>&group=month|quarter|year
 *
 * The income statement (estado de resultados): one per period and for the
 * whole span, per store, «web» and consolidated, in dollars, with the
 * Schedule C / Form 1120-S line of each line. Periods are WHOLE local months
 * (`from` and `to` are widened to their months; at most 36). Scope and the
 * online store: lib/finance-scope.ts.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const doc = await financialStatement(req.scope, await financeScope(req));
    const statements = Object.fromEntries(Object.entries(doc.statements).map(([p, byEntity]) => [p, Object.fromEntries(Object.entries(byEntity).map(([e, s]) => [e, statementDollars(s)]))]));
    res.json({ ...doc, statements });
  });
}
