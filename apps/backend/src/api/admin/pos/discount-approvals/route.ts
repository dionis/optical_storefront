import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanText } from "../../../../lib/establishments";
import { cleanDiscountPct, cleanLines, discountNeedsApproval, sellerTillProblem, type PosLineInput } from "../../../../lib/pos";
import { createApproval, listApprovals, listTerminals, PosError, quoteSale } from "../../../../lib/pos-data";
import { emitAlert } from "../../../../lib/alerts-data";
import { notifyApprovalRequest } from "../../../../lib/pos-notify";
import { posHandler, posScope, scopeStoreIds, sellableStore } from "../../../../lib/pos-route";
import { discountLimitFor, getPosSettings } from "../../../../lib/pos-settings";

/**
 * DESCUENTOS POR APROBAR (HU-16, HU-26).
 *
 *   GET  /admin/pos/discount-approvals?status=pending — admins: todas; los
 *        demás: las que pidieron ellos.
 *   POST /admin/pos/discount-approvals — { store, terminal_id, lines,
 *        discount_pct, reason } pide la aprobación del descuento de ese
 *        presupuesto. El servidor lo recalcula; solo se crea si de verdad
 *        supera el límite de quien pide o deja algo bajo su precio mínimo, y
 *        avisa por email al dueño y a los superadmin.
 *
 * Decidir es POST /:id/decide, solo dueño y superadmin.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    const status = q.status && ["pending", "approved", "rejected", "used", "expired"].includes(q.status) ? q.status : undefined;
    res.json({
      approvals: await listApprovals(req.scope, {
        status,
        establishmentIds: await scopeStoreIds(req, scope),
        requestedBy: scope.is_admin ? undefined : scope.user_id,
      }),
    });
  });
}

interface Body {
  store?: string;
  terminal_id?: string;
  lines?: PosLineInput[];
  discount_pct?: unknown;
  reason?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const body = (req.body ?? {}) as Body;
    const scope = await posScope(req);
    const store = await sellableStore(req, scope, body.store);
    const lines = cleanLines(body.lines);
    if ("reason" in lines) throw new PosError(lines.reason);
    const discount = cleanDiscountPct(body.discount_pct);
    if ("reason" in discount) throw new PosError(discount.reason);

    const [quote, settings, terminals] = await Promise.all([
      quoteSale(req.scope, store.id, lines.lines, discount.pct),
      getPosSettings(req.scope),
      listTerminals(req.scope, [store.id]),
    ]);
    const limitPct = discountLimitFor(scope, settings.discount_limits);
    if (!discountNeedsApproval({ isAdmin: scope.is_admin, pct: quote.discount_pct, limitPct, belowMinimum: quote.below_minimum })) {
      throw new PosError("approval_not_needed", 409);
    }
    const terminal = terminals.find((t) => t.id === body.terminal_id) ?? null;
    const till = sellerTillProblem(scope, store.id, terminal?.id ?? null);
    if (till) throw new PosError(till, 403);
    const approval = await createApproval(req.scope, {
      store,
      terminalId: terminal?.id ?? null,
      requestedBy: scope.user_id,
      quote,
      limitPct,
      reason: cleanText(body.reason, 300),
    });
    const sent = await notifyApprovalRequest(req.scope, approval, store, scope.seller_code ?? terminal?.code ?? store.code);
    // The approvers already got the actionable mail; the rule tells whoever else it lists.
    await emitAlert(req.scope, {
      event: "discount.requested",
      key: `approval:${approval.id}`,
      establishment_id: store.id,
      seller_id: scope.user_id,
      data: { discount_pct: approval.discount_pct, total: approval.total, store_code: store.code, store_name: store.name, seller_code: scope.seller_code },
    });
    res.json({ approval, notified: sent });
  });
}
