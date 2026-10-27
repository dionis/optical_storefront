import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../lib/audit";
import { listEstablishments } from "../../../../../lib/establishments";
import { cleanMethodPatch } from "../../../../../lib/pos";
import { listPaymentMethods, PosError } from "../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../lib/pos-route";
import { POS_MODULE } from "../../../../../modules/pos";
import type PosModuleService from "../../../../../modules/pos/service";

/**
 * POST /admin/pos/payment-methods/:id — edita una forma de pago. Las de serie
 * conservan nombre (sale del diccionario, en el idioma elegido) y tipo; su
 * comisión, tiendas y estado sí cambian. Nunca se borran: las ventas antiguas
 * apuntan a su código. Mismo permiso que el alta.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const methods = await listPaymentMethods(req.scope);
    const method = methods.find((m) => m.id === String(req.params.id ?? ""));
    if (!method) throw new PosError("method_not_found", 404);
    const stores = (await listEstablishments(req.scope)).map((s) => s.id);
    const cleaned = cleanMethodPatch((req.body ?? {}) as Record<string, unknown>, { builtin: method.builtin, creating: false, knownStores: stores });
    if ("reason" in cleaned) throw new PosError(cleaned.reason);
    const p = cleaned.patch;
    if (!Object.keys(p).length) {
      res.json({ payment_methods: methods });
      return;
    }
    await req.scope
      .resolve<PosModuleService>(POS_MODULE)
      .updatePosPaymentMethods({ id: method.id, ...(p as Record<string, unknown>), updated_by: scope.user_id } as never);
    const before = Object.fromEntries(Object.keys(p).map((k) => [k, (method as unknown as Record<string, unknown>)[k]]));
    await recordAudit(req.scope, { actorId: scope.user_id, action: "payment.method", entity: "pos_payment_method", entityId: method.id, before, after: p });
    res.json({ payment_methods: await listPaymentMethods(req.scope) });
  });
}
