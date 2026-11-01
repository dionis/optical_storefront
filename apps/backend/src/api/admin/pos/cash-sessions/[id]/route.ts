import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listAudit } from "../../../../../lib/audit";
import { getSession } from "../../../../../lib/cash";
import { canSellAt } from "../../../../../lib/pos";
import { PosError } from "../../../../../lib/pos-data";
import { customerContacts, posHandler, posScope } from "../../../../../lib/pos-route";
import { POS_MODULE } from "../../../../../modules/pos";
import type PosModuleService from "../../../../../modules/pos/service";

/**
 * GET /admin/pos/cash-sessions/:id — one session with its full ledger (who,
 * till, sale), the sales its lines point at (number, customer name, status)
 * and the session's audit trail (open / close / approve / documents). What
 * the movement panel shows when a row is clicked (owner: "the whole detail:
 * who did it, time, date, place, amount, why").
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const session = await getSession(req.scope, String(req.params.id ?? ""));
    if (!session) throw new PosError("cash_not_found", 404);
    if (!canSellAt(scope, session.establishment_id)) throw new PosError("forbidden_store", 403);
    const saleIds = [...new Set(session.movements.map((m) => m.sale_id).filter((v): v is string => Boolean(v)))];
    const pos = req.scope.resolve<PosModuleService>(POS_MODULE);
    const rows = saleIds.length ? await pos.listPosSales({ id: saleIds }, { take: saleIds.length }) : [];
    const contacts = await customerContacts(req.scope, rows.map((s) => s.customer_id));
    const sales = Object.fromEntries(
      rows.map((s) => [s.id, { id: s.id, number: s.number, status: s.status, customer_name: s.customer_id ? contacts.get(s.customer_id)?.name ?? null : null, total: Number(s.total_cents) / 100, seller_code: s.seller_code ?? null }])
    );
    const audit = await listAudit(req.scope, { entity: "cash_session", entityId: session.id }, 50).catch(() => []);
    res.json({ session, sales, audit });
  });
}
