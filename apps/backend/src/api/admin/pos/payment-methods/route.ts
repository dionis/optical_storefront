import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanText } from "../../../../lib/establishments";
import { methodCodeFor } from "../../../../lib/pos";
import { listPaymentMethods, PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { POS_MODULE } from "../../../../modules/pos";
import type PosModuleService from "../../../../modules/pos/service";

/**
 * FORMAS DE PAGO del punto de venta (configuración).
 *
 *   GET  /admin/pos/payment-methods — todas, activas e inactivas.
 *   POST /admin/pos/payment-methods — alta { label, receivable? }; el código lo
 *        deriva el servidor y nunca se reutiliza.
 *
 * Solo dueño y superadmin: estas rutas no están en la lista de los roles
 * restringidos (lib/staff-roles.ts), así que la guardia de /admin los deja fuera.
 * La caja lee las activas en GET /admin/pos/context.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.json({ payment_methods: await listPaymentMethods(req.scope) });
}

interface CreateBody {
  label?: string;
  receivable?: boolean;
}

export async function POST(req: AuthenticatedMedusaRequest<CreateBody>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const body = (req.body ?? {}) as CreateBody;
    const label = cleanText(body.label, 40);
    if (!label) throw new PosError("label_required");
    const svc = req.scope.resolve<PosModuleService>(POS_MODULE);
    // Codes of deleted rows too: the unique index covers every row.
    const all = await svc.listPosPaymentMethods({}, { take: 500, withDeleted: true });
    const actorId = req.auth_context?.actor_id ?? null;
    await svc.createPosPaymentMethods({
      code: methodCodeFor(label, all.map((m) => m.code)),
      label,
      receivable: body.receivable === true,
      builtin: false,
      sort_order: 100 + all.length,
      created_by: actorId,
      updated_by: actorId,
    });
    res.json({ payment_methods: await listPaymentMethods(req.scope) });
  });
}
