import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import { localParts } from "./alerts";
import { listEstablishments } from "./establishments";
import { sellableStores } from "./pos";
import type { AnalyticsFilter } from "./sales-analytics";
import { getStaffScope, type StaffScope } from "./staff-scope";
import { tenant } from "./tenant";
import { PosError } from "./pos-data";

/**
 * Filters of the dashboards from the query string, with the caller's scope on
 * top (permission matrix, "Panel global"): owner and superadmin everything,
 * the web included; supervisor and manager their stores; a seller their own
 * sales ("Personal"). A filter can narrow the scope, never widen it.
 */
const list = (v: unknown): string[] | null => {
  const s = typeof v === "string" ? v : "";
  const items = s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
  return items.length ? items : null;
};
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function analyticsFilter(req: AuthenticatedMedusaRequest): Promise<{ filter: AnalyticsFilter; scope: StaffScope }> {
  const userId = req.auth_context?.actor_id;
  if (!userId) throw new PosError("forbidden_role", 403);
  const scope = await getStaffScope(req.scope, userId);
  if (!scope.role) throw new PosError("forbidden_role", 403);
  const q = req.query as Record<string, unknown>;
  const today = localParts(new Date(), tenant().timezone).date;
  const to = day(q.to) ?? today;
  const from = day(q.from) ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400_000).toISOString().slice(0, 10);
  if (from > to) throw new PosError("bad_range");

  let stores = list(q.stores);
  let sellers = list(q.sellers);
  if (!scope.is_admin) {
    const mine = sellableStores(scope, await listEstablishments(req.scope)).map((s) => s.id);
    stores = (stores ?? mine).filter((s) => mine.includes(s));
    if (!stores.length) stores = ["-"];
    if (scope.role === "seller") sellers = [scope.user_id];
  }
  const rx = q.rx === "1" ? true : q.rx === "0" ? false : null;
  return {
    scope,
    filter: {
      from,
      to,
      stores,
      sellers,
      products: list(q.products),
      brands: list(q.brands),
      categories: list(q.categories),
      paymentMethods: list(q.payment_methods),
      lensDesigns: list(q.lens_designs),
      hasPrescription: rx,
      includeVoided: q.voided === "1",
    },
  };
}
