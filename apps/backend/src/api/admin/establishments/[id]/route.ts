import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ESTABLISHMENT_MODULE } from "../../../../modules/establishment";
import type EstablishmentModuleService from "../../../../modules/establishment/service";
import { cleanText, listEstablishments, ONLINE_KIND, STORE_KINDS } from "../../../../lib/establishments";
import { isValidPhone } from "../../../../lib/field-rules";
import { forgetOnlineStore } from "../../../../lib/online-store";
import { normalizeColor } from "../../../../lib/store-color";

/**
 * POST /admin/establishments/:id { name?, address?, phone?, color?, kind?, receipt_note?, is_active? }
 *
 * Edita una tienda. El código no se cambia nunca (está impreso en recibos y
 * fichas). No hay DELETE: una tienda con historial solo se desactiva (HU-01).
 *
 * `kind: "online"` makes the store THE online store (lib/online-store.ts): the
 * web shop sells at its prices and its orders are this store's sales. Only one
 * active store can be it — a second one is refused with `online_exists` (409)
 * and the code of the store that already is.
 */
interface UpdateBody {
  name?: string;
  address?: string | null;
  phone?: string | null;
  color?: string;
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
  if ("phone" in body) {
    const phone = cleanText(body.phone, 40);
    if (phone && !isValidPhone(phone)) {
      res.status(422).json({ type: "invalid_data", reason: "bad_phone", message: "The store's phone is not valid." });
      return;
    }
    patch.phone = phone;
  }
  if ("color" in body) {
    const color = normalizeColor(body.color);
    if (!color) {
      res.status(422).json({ type: "invalid_data", reason: "bad_color", message: "A color must be #RRGGBB." });
      return;
    }
    patch.color = color;
  }
  if ("kind" in body) {
    if (!(STORE_KINDS as readonly string[]).includes(String(body.kind))) {
      res.status(422).json({ type: "invalid_data", reason: "bad_kind", message: "Unknown store kind." });
      return;
    }
    patch.kind = body.kind;
  }
  // One online store at a time: becoming it, or coming back to life as it.
  const nextKind = String(patch.kind ?? (current as { kind?: string }).kind ?? "own");
  const nextActive = typeof body.is_active === "boolean" ? body.is_active : Boolean(current.is_active);
  const becomesOnline = nextKind === ONLINE_KIND && nextActive;
  if (becomesOnline) {
    const other = (await listEstablishments(req.scope)).find((e) => e.id !== id && e.kind === ONLINE_KIND && e.is_active);
    if (other) {
      res.status(409).json({ type: "not_allowed", reason: "online_exists", code: other.code, name: other.name, message: `${other.code} is already the online store.` });
      return;
    }
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
  forgetOnlineStore();
  res.json({ establishments: await listEstablishments(req.scope) });
}
