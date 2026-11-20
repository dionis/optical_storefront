import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { localParts } from "../../../../lib/alerts";
import { cashReport, redactCashReport } from "../../../../lib/cash-report";
import { listEstablishments } from "../../../../lib/establishments";
import { sellableStores } from "../../../../lib/pos";
import { PosError } from "../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../lib/pos-route";
import { insightAccess } from "../../../../lib/sales-insights";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/pos/cash-report?from=YYYY-MM-DD&to=YYYY-MM-DD&establishment_id=&seller_id=
 *
 * Payments per method, manual cash movements with their reasons, closings and
 * the per-day series of the period (local dates of the tenant). Scope follows
 * the permission matrix: admins any store (or all); supervisors and managers
 * their stores; a seller only what they received or recorded, at their till.
 * A filter narrows the scope, never widens it. Default period: this month.
 */
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const list = (v: unknown): string[] | null => {
  const items = (typeof v === "string" ? v : "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
  return items.length ? items : null;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!scope.role && !scope.is_admin) throw new PosError("forbidden_role", 403);
    const q = req.query as Record<string, unknown>;
    const today = localParts(new Date(), tenant().timezone).date;
    const to = day(q.to) ?? today;
    const from = day(q.from) ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw new PosError("bad_range");
    // A year and a day at most: the movement list is returned in full.
    if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400_000) throw new PosError("bad_range");

    let stores = list(q.establishment_id);
    let sellers = list(q.seller_id);
    let terminals: string[] | null = null;
    if (!scope.is_admin) {
      const mine = sellableStores(scope, await listEstablishments(req.scope)).map((s) => s.id);
      stores = (stores ?? mine).filter((s) => mine.includes(s));
      if (!stores.length) stores = ["-"];
      if (scope.role === "seller") {
        sellers = [scope.user_id];
        if (scope.seller?.terminal_id) terminals = [scope.seller.terminal_id];
      }
    }
    // The processor's charge is a cost, and a seller reads this screen to
    // reconcile their own till: it leaves only for a caller who may see costs
    // (same rule as the analytics, insightAccess). Redacted on the server —
    // hiding the column in the panel would still have sent the number.
    const report = await cashReport(req.scope, { from, to, stores, sellers, terminals });
    res.json(redactCashReport(report, insightAccess(scope).profit));
  });
}
