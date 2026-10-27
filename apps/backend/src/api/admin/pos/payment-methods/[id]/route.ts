import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanText } from "../../../../../lib/establishments";
import { listPaymentMethods, PosError } from "../../../../../lib/pos-data";
import { posHandler } from "../../../../../lib/pos-route";
import { POS_MODULE } from "../../../../../modules/pos";
import type PosModuleService from "../../../../../modules/pos/service";

/**
 * POST /admin/pos/payment-methods/:id — { label?, receivable?, is_active? }.
 * Solo dueño y superadmin (ver ../route.ts). Las formas de pago de serie se
 * pueden desactivar pero no renombrar: su nombre sale del diccionario, en el
 * idioma elegido. Nunca se borran: las ventas antiguas apuntan a su código.
 */
interface UpdateBody {
  label?: string;
  receivable?: boolean;
  is_active?: boolean;
}

export async function POST(req: AuthenticatedMedusaRequest<UpdateBody>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const body = (req.body ?? {}) as UpdateBody;
    const svc = req.scope.resolve<PosModuleService>(POS_MODULE);
    const [method] = await svc.listPosPaymentMethods({ id: String(req.params.id ?? "") }, { take: 1 });
    if (!method) throw new PosError("method_not_found", 404);

    const update: Record<string, unknown> = { id: method.id, updated_by: req.auth_context?.actor_id ?? null };
    if (typeof body.is_active === "boolean") update.is_active = body.is_active;
    if (!method.builtin) {
      if (body.label !== undefined) {
        const label = cleanText(body.label, 40);
        if (!label) throw new PosError("label_required");
        update.label = label;
      }
      if (typeof body.receivable === "boolean") update.receivable = body.receivable;
    }
    await svc.updatePosPaymentMethods(update as never);
    res.json({ payment_methods: await listPaymentMethods(req.scope) });
  });
}
