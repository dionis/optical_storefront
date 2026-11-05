import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { localParts } from "../../../../lib/alerts";
import { readyToHand } from "../../../../lib/ready-orders";
import { listSales, listTerminals, PosError } from "../../../../lib/pos-data";
import { listEstablishments } from "../../../../lib/establishments";
import { openSessionFor } from "../../../../lib/cash";
import { sellerOfUser } from "../../../../lib/seller-link";
import { posHandler } from "../../../../lib/pos-route";
import { lineCommissionCents, salesSummary } from "../../../../lib/sales-analytics";
import { profileOf } from "../../../../lib/staff-profile-data";
import { getStaffScope } from "../../../../lib/staff-scope";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/sales-analytics/me — the seller's own panel (E8):
 *  - today, this week and this month: sales, total and average ticket (HU-50);
 *  - commission so far and what is left to the monthly goal (HU-53);
 *  - their customers' orders back from the lab, ready to hand over (HU-52).
 * The list of their sales (HU-51) is Store sales.
 *
 * It is also where a seller lands when they open the panel, so it carries the
 * day at a glance: their store and till (with the register open or not) and
 * their latest sales. `store_today` (the store's sales today and the person's
 * share) only leaves for the other roles: by the owner's rule a seller never
 * sees the general status of anything, not even of their own store.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const userId = req.auth_context?.actor_id;
    if (!userId) throw new PosError("forbidden_role", 403);
    const scope = await getStaffScope(req.scope, userId);
    const tz = tenant().timezone;
    const today = localParts(new Date(), tz);
    const back = (days: number) => new Date(Date.parse(`${today.date}T00:00:00Z`) - days * 86400_000).toISOString().slice(0, 10);
    const weekStart = back((today.weekday + 6) % 7); // Monday
    const monthStart = `${today.date.slice(0, 8)}01`;
    // A seller with several stores may look at one of them (MySales store filter); nothing else changes.
    const st = String((req.query as Record<string, unknown>).store ?? "").trim();
    const base = { to: today.date, stores: st ? [st] : null, sellers: [userId] };
    const [d, w, m] = await Promise.all([
      salesSummary(req.scope, { ...base, from: today.date }),
      salesSummary(req.scope, { ...base, from: weekStart }),
      salesSummary(req.scope, { ...base, from: monthStart }),
    ]);
    const profile = await profileOf(req.scope, userId);
    // A counter seller's record carries the commission when the profile has none.
    const record = scope.role === "seller" ? await sellerOfUser(req.scope, userId) : null;
    const commissionPct = profile.commission_pct ?? (record && record.commission_pct > 0 ? record.commission_pct : null);

    // Where they sell: the store and till of their seller record.
    const storeId = scope.seller?.establishment_id ?? null;
    const terminalId = scope.seller?.terminal_id ?? null;
    const [stores, tills, storeToday, recent, cashOpen] = await Promise.all([
      storeId ? listEstablishments(req.scope) : Promise.resolve([]),
      storeId ? listTerminals(req.scope, [storeId]) : Promise.resolve([]),
      storeId && scope.role !== "seller" ? salesSummary(req.scope, { from: today.date, to: today.date, stores: [storeId], sellers: null }) : Promise.resolve(null),
      listSales(req.scope, { establishmentIds: null, sellerId: userId }, 6),
      // Over the STORE, not the till: openSessionFor takes an establishment id,
      // and a till id never matches one, so `cash_open` was always false — the
      // seller's panel could not tell an open register from a closed one.
      // Opening and closing are store-wide by the owner's decision anyway.
      storeId ? openSessionFor(req.scope, storeId) : Promise.resolve(null),
    ]);
    const store = stores.find((x) => x.id === storeId) ?? null;
    const till = tills.find((x) => x.id === terminalId) ?? null;
    // Goal and commission share one base: the month's NET (total − tax), never the gross.
    const monthNet = Math.round((m.current.total - m.current.tax) * 100) / 100;
    const goal = profile.monthly_goal ?? null;
    // Per line, as the Executive and Vendedores add it: one rounding per sold line, not one over the month.
    const commissionCents = commissionPct === null ? 0 : await lineCommissionCents(req.scope, { ...base, from: monthStart }, commissionPct);

    // Ready to hand over: their open sales whose order is back from the lab.
    const ready = (await readyToHand(req.scope, await listSales(req.scope, { establishmentIds: null, sellerId: userId, status: "completed" }, 200)))
      .map(({ id, number, balance, stage }) => ({ id, number, balance, stage }));

    res.json({
      role: scope.role,
      seller_code: scope.seller_code,
      today: d.current,
      week: w.current,
      month: m.current,
      balance_due: m.balance_due,
      commission: commissionPct === null ? null : { pct: commissionPct, amount: commissionCents / 100 },
      goal: goal === null ? null : { amount: goal, done: monthNet, left: Math.max(0, Math.round((goal - monthNet) * 100) / 100) },
      ready,
      workplace: store
        ? { store: { id: store.id, code: store.code, name: store.name }, terminal: till ? { id: till.id, code: till.code, name: till.name } : null, cash_open: Boolean(cashOpen) }
        : null,
      store_today: storeToday ? { ...storeToday.current, mine: d.current.total } : null,
      recent: recent.map((r) => ({ id: r.id, number: r.number, total: r.total, balance: r.balance, status: r.status, delivered: Boolean(r.delivered_at), created_at: r.created_at })),
    });
  });
}
