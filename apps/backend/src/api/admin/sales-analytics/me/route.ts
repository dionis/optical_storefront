import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { localParts } from "../../../../lib/alerts";
import { deriveOrderProgress, stageIndex } from "../../../../lib/order-status";
import { listSales, PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { salesSummary } from "../../../../lib/sales-analytics";
import { profileOf } from "../../../../lib/staff-profile-data";
import { getStaffScope } from "../../../../lib/staff-scope";
import { tenant } from "../../../../lib/tenant";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * GET /admin/sales-analytics/me — the seller's own panel (E8):
 *  - today, this week and this month: sales, total and average ticket (HU-50);
 *  - commission so far and what is left to the monthly goal (HU-53);
 *  - their customers' orders back from the lab, ready to hand over (HU-52).
 * The list of their sales (HU-51) is Store sales.
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
    const base = { to: today.date, stores: null, sellers: [userId] };
    const [d, w, m] = await Promise.all([
      salesSummary(req.scope, { ...base, from: today.date }),
      salesSummary(req.scope, { ...base, from: weekStart }),
      salesSummary(req.scope, { ...base, from: monthStart }),
    ]);
    const profile = await profileOf(req.scope, userId);
    const commissionPct = profile.commission_pct ?? null;
    const goal = profile.monthly_goal ?? null;

    // Ready to hand over: their open sales whose order is back from the lab.
    const open = (await listSales(req.scope, { establishmentIds: null, sellerId: userId, status: "completed" }, 200)).filter((s) => !s.delivered_at && s.order_id);
    let ready: Array<{ id: string; number: string; balance: number; stage: string }> = [];
    if (open.length) {
      const { data } = await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({
        entity: "order",
        fields: ["id", "status", "payment_status", "fulfillment_status", "created_at", "metadata", "items.metadata", "fulfillments.*"],
        filters: { id: open.map((s) => s.order_id as string) },
      });
      const stageOf = new Map((data as Array<Record<string, unknown>>).map((o) => [String(o.id), deriveOrderProgress(o as never).stage]));
      ready = open
        .filter((s) => {
          const st = stageOf.get(s.order_id as string);
          return st && stageIndex(st) >= stageIndex("shipped");
        })
        .map((s) => ({ id: s.id, number: s.number, balance: s.balance, stage: stageOf.get(s.order_id as string) as string }));
    }

    res.json({
      role: scope.role,
      seller_code: scope.seller_code,
      today: d.current,
      week: w.current,
      month: m.current,
      balance_due: m.balance_due,
      commission: commissionPct === null ? null : { pct: commissionPct, amount: Math.round(m.current.total * commissionPct) / 100 },
      goal: goal === null ? null : { amount: goal, done: m.current.total, left: Math.max(0, Math.round((goal - m.current.total) * 100) / 100) },
      ready,
    });
  });
}
