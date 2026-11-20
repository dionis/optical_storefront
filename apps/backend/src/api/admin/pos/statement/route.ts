import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { localParts } from "../../../../lib/alerts";
import { listEstablishments } from "../../../../lib/establishments";
import { sellableStores } from "../../../../lib/pos";
import { PosError } from "../../../../lib/pos-data";
import { ownSalesOnly, posHandler, posScope, sellableStore } from "../../../../lib/pos-route";
import { loadStatement, periodFromQuery } from "../../../../lib/pos-statement";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/pos/statement?establishment_id=<id|all>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Estado de cuenta of a store for a period (default: the whole current month
 * in the tenant time zone): every till sale with lines and payments, totals by
 * method, seller and day, and the settlement of a family/partner/consignment
 * store. Permission matrix: owner and superadmin any store or `all` (the whole
 * business); supervisor and manager one of their stores (`establishment_id`
 * required); a seller only their own sales of their store, without the
 * settlement.
 *
 * Errors with `reason` (bad_range, store_not_found, forbidden_store); the
 * panel translates with adm.err.pos.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    const period = periodFromQuery(q, localParts(new Date(), tenant().timezone).date);
    const id = (q.establishment_id ?? q.store ?? "").trim();
    const all = id === "all";
    if (all && !scope.is_admin) throw new PosError("forbidden_store", 403);
    if (!all && !id) throw new PosError("store_not_found", 404);
    // An admin may close the books of a store already deactivated; everyone else, only an active store of theirs.
    const adminStore = scope.is_admin && !all ? (await listEstablishments(req.scope)).find((s) => s.id === id) : null;
    if (scope.is_admin && !all && !adminStore) throw new PosError("store_not_found", 404);
    const stores = all ? sellableStores(scope, await listEstablishments(req.scope)) : [adminStore ?? (await sellableStore(req, scope, id))];
    const statement = await loadStatement(req.scope, { stores, all, sellerId: ownSalesOnly(scope) ? scope.user_id : null }, period);
    res.json(statement);
  });
}
