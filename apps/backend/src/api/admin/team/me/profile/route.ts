import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../lib/audit";
import { cleanProfilePatch, viewProfile } from "../../../../../lib/staff-profile";
import { profileOf, saveProfile } from "../../../../../lib/staff-profile-data";
import { getStaffScope, invalidateStaffScope } from "../../../../../lib/staff-scope";

/**
 * MI PERFIL (HU-98): cualquier persona del equipo ve su perfil y edita sus
 * datos de contacto y preferencias (teléfonos, email para avisos, idioma).
 * El resto (código de vendedor, privilegios, comisión, emergencia, notas) solo
 * lo cambian el dueño o un superadmin, en /admin/team/:id/profile.
 *
 * Abierta a todos los roles (lib/staff-roles.ts). Errores con `reason`; el
 * panel traduce con adm.err.profile.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const userId = req.auth_context?.actor_id ?? "";
  const scope = await getStaffScope(req.scope, userId);
  const profile = await profileOf(req.scope, userId);
  res.json({ profile: viewProfile(profile, { isAdmin: scope.is_admin, isSelf: true, managesThem: false }) });
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const userId = req.auth_context?.actor_id ?? "";
  const cleaned = cleanProfilePatch((req.body ?? {}) as Record<string, unknown>, "self");
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, field: cleaned.field, message: `Profile: ${cleaned.reason}` });
    return;
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
  res.json({ profile: viewProfile(after, { isAdmin: scope.is_admin, isSelf: true, managesThem: false }) });
}
