import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../lib/establishments";
import { acceptedAt, sellableStores, sellerTillProblem } from "../../../../lib/pos";
import { ensureTerminal, listPaymentMethods, VOID_REASONS } from "../../../../lib/pos-data";
import { canVoid, posHandler, posScope } from "../../../../lib/pos-route";
import { discountLimitFor, getPosSettings } from "../../../../lib/pos-settings";

/**
 * GET /admin/pos/context — what the till needs to open: the stores this user
 * may sell in with their tills (a store without one gets Op#-POS1 on demand),
 * the payment methods accepted in each, the user's discount limit, whether
 * they void or only ask, and the optical-change thresholds. Every role.
 *
 * A user with the `seller` role gets only the store and till of their seller
 * record (`assigned`), or `seller_block` (no record / inactive) and no stores.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const actorId = req.auth_context?.actor_id ?? null;
    const [all, methods, settings] = await Promise.all([listEstablishments(req.scope), listPaymentMethods(req.scope), getPosSettings(req.scope)]);
    const counter = scope.role === "seller" && !scope.is_admin ? scope.seller ?? null : null;
    const sellerBlock = sellerTillProblem(scope, counter?.establishment_id ?? null, counter?.terminal_id ?? null);
    const stores = [];
    for (const s of sellerBlock ? [] : sellableStores(scope, all)) {
      if (counter && s.id !== counter.establishment_id) continue;
      const terminals = (await ensureTerminal(req.scope, s, actorId)).filter((t) => t.is_active && (!counter || t.id === counter.terminal_id));
      stores.push({
        id: s.id,
        code: s.code,
        name: s.name,
        terminals,
        payment_methods: methods.filter((m) => acceptedAt(m, s.id)).map((m) => m.code),
      });
    }
    res.json({
      role: scope.role,
      is_admin: scope.is_admin,
      seller_code: scope.seller_code,
      seller_block: sellerBlock,
      assigned: counter && !sellerBlock ? { establishment_id: counter.establishment_id, terminal_id: counter.terminal_id } : null,
      privileges: scope.privileges,
      stores,
      payment_methods: methods.filter((m) => m.is_active),
      discount_limit_pct: discountLimitFor(scope, settings.discount_limits),
      can_void: canVoid(scope),
      void_reasons: VOID_REASONS,
      optical_thresholds: settings.optical_thresholds,
    });
  });
}
