import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ESTABLISHMENT_MODULE } from "../../../../modules/establishment";
import type EstablishmentModuleService from "../../../../modules/establishment/service";
import { cleanText, listEstablishments } from "../../../../lib/establishments";

/**
 * POST /admin/establishments/:id { name?, address?, phone?, is_active? }
 *
 * Edita una tienda. El código no se cambia nunca (está impreso en recibos y
 * fichas). No hay DELETE: una tienda con historial solo se desactiva (HU-01).
 */
interface UpdateBody {
  name?: string;
  address?: string | null;
  phone?: string | null;
  is_active?: boolean;
}

export async function POST(req: AuthenticatedMedusaRequest<UpdateBody>, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as UpdateBody;
  const svc = req.scope.resolve<EstablishmentModuleService>(ESTABLISHMENT_MODULE);

  const [current] = await svc.listEstablishments({ id }, { take: 1 });
  if (!current) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "Store not found." });
    return;
  }

  const patch: Record<string, unknown> = { id, updated_by: req.auth_context?.actor_id ?? null };
  if ("name" in body) {
    const name = cleanText(body.name, 80);
    if (!name) {
      res.status(422).json({ type: "invalid_data", reason: "name_required", message: "A store name is required." });
      return;
    }
    patch.name = name;
  }
  if ("address" in body) patch.address = cleanText(body.address, 160);
  if ("phone" in body) patch.phone = cleanText(body.phone, 40);
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  await svc.updateEstablishments(patch as never);
  res.json({ establishments: await listEstablishments(req.scope) });
}
