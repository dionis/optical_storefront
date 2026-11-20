import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../lib/audit";
import { isAddressChoice, profileAddressLink, saveFromProfile } from "../../../../../lib/seller-address";
import { ensureStaffCode } from "../../../../../lib/staff-code";
import { cleanProfilePatch, viewProfile } from "../../../../../lib/staff-profile";
import { profileOf, saveProfile } from "../../../../../lib/staff-profile-data";
import { getStaffScope, invalidateStaffScope } from "../../../../../lib/staff-scope";

/**
 * MI PERFIL (HU-98): cualquier persona del equipo ve su perfil y edita sus
 * datos de contacto y preferencias (teléfonos, email para avisos, idioma),
 * además de su nombre para mostrar y su foto (QA D-15, 5-nov-2026). El resto
 * (código de vendedor, privilegios, comisión, emergencia, notas) solo lo
 * cambian el dueño o un superadmin, en /admin/team/:id/profile. La lista es
 * `SELF_EDITABLE_FIELDS` en lib/staff-profile.ts (con prueba).
 *
 * Abierta a todos los roles (lib/staff-roles.ts). Errores con `reason`; el
 * panel traduce con adm.err.profile.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const userId = req.auth_context?.actor_id ?? "";
  await ensureStaffCode(req.scope, userId);
  const scope = await getStaffScope(req.scope, userId);
  const profile = await profileOf(req.scope, userId);
  const link = await profileAddressLink(req.scope, userId, profile.address);
  res.json({ profile: { ...viewProfile(profile, { isAdmin: scope.is_admin, isSelf: true, managesThem: false }), address: link ? link.address : profile.address }, address_link: link });
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const userId = req.auth_context?.actor_id ?? "";
  const { address_choice: rawChoice, ...body } = (req.body ?? {}) as Record<string, unknown>;
  const cleaned = cleanProfilePatch(body, "self");
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, field: cleaned.field, message: `Profile: ${cleaned.reason}` });
    return;
  }
  // One address with the seller record, unless the person decides otherwise.
  const choice = isAddressChoice(rawChoice) ? rawChoice : null;
  if ("address" in cleaned.patch || choice) {
    const saved = await saveFromProfile(req.scope, userId, cleaned.patch.address, choice, userId);
    if (saved.conflict) {
      res.status(409).json({ type: "not_allowed", reason: "address_conflict", other: saved.other, message: "The address differs from the one on the seller record." });
      return;
    }
    cleaned.patch.address = saved.address;
  }
  const { before, after } = await saveProfile(req.scope, userId, cleaned.patch, userId);
  invalidateStaffScope(userId);
  await recordAudit(req.scope, {
    actorId: userId,
    action: "profile.change",
    entity: "staff_profile",
    entityId: userId,
    before: Object.fromEntries(Object.keys(cleaned.patch).map((k) => [k, (before as unknown as Record<string, unknown>)[k]])),
    after: cleaned.patch,
  });
  const scope = await getStaffScope(req.scope, userId);
  const link = await profileAddressLink(req.scope, userId, after.address);
  res.json({ profile: { ...viewProfile(after, { isAdmin: scope.is_admin, isSelf: true, managesThem: false }), address: link ? link.address : after.address }, address_link: link });
}
