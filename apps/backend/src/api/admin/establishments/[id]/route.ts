import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ESTABLISHMENT_MODULE } from "../../../../modules/establishment";
import type EstablishmentModuleService from "../../../../modules/establishment/service";
import { cleanText, listEstablishments, STORE_KINDS } from "../../../../lib/establishments";

/**
 * POST /admin/establishments/:id { name?, address?, phone?, kind?, receipt_note?, is_active? }
 *
 * Edita una tienda. El código no se cambia nunca (está impreso en recibos y
 * fichas). No hay DELETE: una tienda con historial solo se desactiva (HU-01).
 */
interface UpdateBody {
  name?: string;
  address?: string | null;
  phone?: string | null;
  kind?: string;
  receipt_note?: string | null;
  settlement_pct?: number | null;
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
  if ("kind" in body) {
    if (!(STORE_KINDS as readonly string[]).includes(String(body.kind))) {
      res.status(422).json({ type: "invalid_data", reason: "bad_kind", message: "Unknown store kind." });
      return;
    }
    patch.kind = body.kind;
  }
  if ("receipt_note" in body) patch.receipt_note = cleanText(body.receipt_note, 600);
  if ("settlement_pct" in body) {
    const v = body.settlement_pct === null || (body.settlement_pct as unknown) === "" ? null : Number(body.settlement_pct);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) {
      res.status(422).json({ type: "invalid_data", reason: "bad_settlement", message: "Settlement must be 0-100." });
      return;
    }
    patch.settlement_pct = v;
  }
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  await svc.updateEstablishments(patch as never);
  res.json({ establishments: await listEstablishments(req.scope) });
}
