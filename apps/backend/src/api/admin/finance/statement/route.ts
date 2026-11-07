import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { localParts } from "../../../../lib/alerts";
import { financialStatement, MAX_STATEMENT_MONTHS, monthsBetween, STATEMENT_GROUPS, statementDollars, WEB_ENTITY, type StatementGroup } from "../../../../lib/financial-statement";
import { PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { costScope } from "../../../../lib/store-costs-route";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/finance/statement?from=YYYY-MM-DD&to=YYYY-MM-DD&store=<id|web|all>&group=month|quarter|year
 *
 * The income statement (estado de resultados): one per period and for the
 * whole span, per store, «web» and consolidated, in dollars, with the
 * Schedule C / Form 1120-S line of each line. Periods are WHOLE local months
 * (`from` and `to` are widened to their months; at most 36). Same scope as the
 * store result: admins see every store and the web; a person with the costs
 * privilege, only their stores (and no web).
 */
const DAY = /^\d{4}-\d{2}(-\d{2})?$/;

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { storeIds } = await costScope(req);
    const q = req.query as Record<string, string | undefined>;
    const today = localParts(new Date(), tenant().timezone).date;
    const to = q.to && DAY.test(q.to) ? q.to : today;
    const from = q.from && DAY.test(q.from) ? q.from : `${to.slice(0, 4)}-01-01`;
    if (from.slice(0, 7) > to.slice(0, 7)) throw new PosError("bad_range");
    if (monthsBetween(from, to).length > MAX_STATEMENT_MONTHS) throw new PosError("range_too_long");
    const group = (STATEMENT_GROUPS as readonly string[]).includes(String(q.group)) ? (q.group as StatementGroup) : "month";
    const store = String(q.store ?? "all");
    if (storeIds !== null && !storeIds.length) throw new PosError("forbidden_store", 403);
    let ids: string[] | null = storeIds;
    let web = storeIds === null;
    if (store === WEB_ENTITY) {
      if (storeIds !== null) throw new PosError("forbidden_store", 403);
      ids = [];
    } else if (store && store !== "all") {
      if (storeIds !== null && !storeIds.includes(store)) throw new PosError("forbidden_store", 403);
      ids = [store];
      web = false;
    }
    const doc = await financialStatement(req.scope, { from, to, group, storeIds: ids, web });
    const statements = Object.fromEntries(Object.entries(doc.statements).map(([p, byEntity]) => [p, Object.fromEntries(Object.entries(byEntity).map(([e, s]) => [e, statementDollars(s)]))]));
    res.json({ ...doc, statements });
  });
}
