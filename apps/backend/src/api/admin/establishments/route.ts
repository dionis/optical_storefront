import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { cleanText, createEstablishment, listEstablishments } from "../../../lib/establishments";

/**
 * TIENDAS (establecimientos).
 *
 *   GET  /admin/establishments — todas, activas e inactivas, por orden de alta.
 *   POST /admin/establishments — alta { name, address?, phone? }; el código
 *        (Op1, Op2…) lo asigna el servidor y nunca se reutiliza.
 *
 * Solo dueño y superadmin llegan aquí: la guardia de /admin (lib/staff-guard.ts)
 * deja fuera al resto de roles. Errores con `reason`; el panel traduce con
 * adm.err.stores.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.json({ establishments: await listEstablishments(req.scope) });
}

interface CreateBody {
  name?: string;
  address?: string;
  phone?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<CreateBody>, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as CreateBody;
  const name = cleanText(body.name, 80);
  if (!name) {
    res.status(422).json({ type: "invalid_data", reason: "name_required", message: "A store name is required." });
    return;
  }
  const actorId = req.auth_context?.actor_id ?? null;
  const created = await createEstablishment(req.scope, {
    name,
    address: cleanText(body.address, 160),
    phone: cleanText(body.phone, 40),
    actorId,
  });
  req.scope
    .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
    .info(`[stores] ${created.code} "${created.name}" created by ${actorId ?? "?"} (sales channel ${created.sales_channel_id})`);
  res.json({ establishment: created, establishments: await listEstablishments(req.scope) });
}
