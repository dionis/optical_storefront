import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../lib/establishments";
import { PosError } from "../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../lib/pos-route";
import { startMap } from "../../../../lib/start-map";

/**
 * GET /admin/pos/start-map?store=<id|web|all> — the start map that opens the
 * panel (lib/start-map.ts): sales of yesterday / today / this week / last week
 * / this month / last month with their costs, what is pending (in the lab, to
 * deliver, money on the street, overdue, approvals, open registers) and one
 * line per store. One call, scoped by role: owner and superadmin everything
 * (`store` narrows to one store or `web`); supervisor and manager their stores;
 * a seller their own sales, plus the balances of their store. Cost and profit
 * leave only when the server allows (`access.profit`); a seller gets their own
 * commission. Errors with `reason` (adm.err.pos.<reason>).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!scope.role) throw new PosError("forbidden_role", 403);
    const store = String((req.query as Record<string, unknown>).store ?? "").trim();
    res.json(await startMap(req.scope, scope, await listEstablishments(req.scope), store));
  });
}
