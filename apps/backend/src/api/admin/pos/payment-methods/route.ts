import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../lib/audit";
import { listEstablishments } from "../../../../lib/establishments";
import { cleanMethodPatch, methodCodeFor } from "../../../../lib/pos";
import { listPaymentMethods, PosError } from "../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../lib/pos-route";
import { POS_MODULE } from "../../../../modules/pos";
import type PosModuleService from "../../../../modules/pos/service";

/**
 * FORMAS DE PAGO del punto de venta (HU-111, HU-112).
 *
 *   GET  /admin/pos/payment-methods — todas, activas e inactivas.
 *   POST /admin/pos/payment-methods — alta { label, label_en?, kind?,
 *        receivable?, fee_pct?, fee_fixed?, counts_as_cash?, establishment_ids?,
 *        reference_fields? }. El código lo deriva el servidor y nunca se reutiliza.
 *
 * Dueño, superadmin o quien tenga el privilegio «Gestionar formas de pago»
 * (lib/staff-roles.ts PRIVILEGED_ALLOWED). La caja lee las activas en
 * GET /admin/pos/context.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    res.json({ payment_methods: await listPaymentMethods(req.scope) });
  });
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const stores = (await listEstablishments(req.scope)).map((s) => s.id);
    const cleaned = cleanMethodPatch((req.body ?? {}) as Record<string, unknown>, { builtin: false, creating: true, knownStores: stores });
    if ("reason" in cleaned) throw new PosError(cleaned.reason);
    const svc = req.scope.resolve<PosModuleService>(POS_MODULE);
    // Codes of deleted rows too: the unique index covers every row.
    const all = await svc.listPosPaymentMethods({}, { take: 500, withDeleted: true });
    const p = cleaned.patch;
    const created = await svc.createPosPaymentMethods({
      ...(p as Record<string, unknown>),
      code: methodCodeFor(p.label as string, all.map((m) => m.code)),
      kind: p.kind ?? "other",
      builtin: false,
      sort_order: 100 + all.length,
      created_by: scope.user_id,
      updated_by: scope.user_id,
    } as never);
    await recordAudit(req.scope, { actorId: scope.user_id, action: "payment.method", entity: "pos_payment_method", entityId: (created as { id: string }).id, after: p });
    res.json({ payment_methods: await listPaymentMethods(req.scope) });
  });
}
