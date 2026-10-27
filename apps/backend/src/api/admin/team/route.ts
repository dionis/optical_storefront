import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService, IUserModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { STAFF_MODULE } from "../../../modules/staff";
import type StaffModuleService from "../../../modules/staff/service";
import { resolveRole, roleChangeDenied, type StaffRole } from "../../../lib/staff-roles";
import { assignmentsByUser, getStaffScope, invalidateStaffScope } from "../../../lib/staff-scope";

/**
 * EQUIPO del panel: administradores de la tienda.
 *
 *   GET  /admin/team      — lista del equipo con el rol de cada persona.
 *   POST /admin/team      — crea un usuario con contraseña TEMPORAL y un rol;
 *                           queda marcado must_change_password y el panel le
 *                           exige cambiarla en su primera entrada.
 *
 * DUEÑO = el usuario más antiguo (creado con `npx medusa user` al montar la
 * tienda; la API lo sigue llamando `is_super`). No se puede borrar ni cambiar
 * de rol — ver [id]/route.ts y [id]/role/route.ts — así la tienda nunca se
 * queda sin su administrador raíz por un clic de más. Los roles y quién puede
 * darlos viven en lib/staff-roles.ts.
 *
 * Reglas del proyecto: errores con `reason` (código) + message en inglés para
 * logs; el panel traduce con adm.err.team.<reason>.
 */

export interface TeamMember {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  is_super: boolean;
  must_change_password: boolean;
  /** null = sus roles están todos desactivados: sin acceso. */
  role: StaffRole | null;
  /** Admin anterior a los roles, que conserva su acceso como superadmin. */
  role_legacy: boolean;
}

export async function listTeam(req: AuthenticatedMedusaRequest): Promise<TeamMember[]> {
  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  const all = await users.listUsers({}, { take: 200, order: { created_at: "ASC" } });
  const byUser = await assignmentsByUser(req.scope, all.map((u) => u.id));
  return all.map((u, i) => {
    // El más antiguo es el dueño (super admin) del sistema.
    const resolved = resolveRole({ isOwner: i === 0, assignments: byUser.get(u.id) ?? [] });
    return {
      id: u.id,
      email: u.email,
      first_name: u.first_name ?? null,
      last_name: u.last_name ?? null,
      created_at: String(u.created_at),
      is_super: i === 0,
      must_change_password: Boolean((u.metadata as Record<string, unknown> | null)?.["must_change_password"]),
      role: resolved.role,
      role_legacy: resolved.legacy,
    };
  });
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.json({ team: await listTeam(req), me: req.auth_context?.actor_id ?? null });
}

interface CreateBody {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  /** Rol inicial. Por omisión superadmin: el acceso que daba esta pantalla antes de los roles. */
  role?: string;
}

export async function POST(
  req: AuthenticatedMedusaRequest<CreateBody>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as CreateBody;
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(422).json({ type: "invalid_data", reason: "bad_email", message: "A valid email is required." });
    return;
  }
  if (password.length < 8) {
    res.status(422).json({ type: "invalid_data", reason: "weak_password", message: "Temporary password must be at least 8 characters." });
    return;
  }

  const role = String(body.role ?? "superadmin");
  const actorId = req.auth_context?.actor_id ?? "";
  const actor = await getStaffScope(req.scope, actorId);
  const denied = roleChangeDenied({
    actorRole: actor.role,
    targetIsOwner: false,
    targetRole: null,
    nextRole: role,
    actorIsTarget: false,
  });
  if (denied) {
    res.status(denied === "bad_role" ? 422 : 403).json({ type: "not_allowed", reason: denied, message: `Cannot create a user with role ${role}.` });
    return;
  }

  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  const existing = await users.listUsers({ email }, { take: 1 });
  if (existing.length) {
    res.status(409).json({ type: "not_allowed", reason: "email_taken", message: "An admin with that email already exists." });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const registered = await auth.register("emailpass", { body: { email, password } });
  if (!registered.success || !registered.authIdentity) {
    // Identidad huérfana de un intento anterior u otro rechazo del provider.
    res.status(409).json({ type: "not_allowed", reason: "identity_exists", message: "That email already has a credential identity." });
    return;
  }

  const user = await users.createUsers({
    email,
    first_name: String(body.first_name ?? "").trim().slice(0, 80) || undefined,
    last_name: String(body.last_name ?? "").trim().slice(0, 80) || undefined,
    // La contraseña es TEMPORAL: el panel bloquea el acceso hasta cambiarla.
    metadata: { must_change_password: true, created_by: req.auth_context?.actor_id ?? null },
  });

  await auth.updateAuthIdentities([
    { id: registered.authIdentity.id, app_metadata: { user_id: user.id } },
  ]);

  const staff = req.scope.resolve<StaffModuleService>(STAFF_MODULE);
  await staff.createStaffAssignments({
    user_id: user.id,
    establishment_id: null,
    role: role as StaffRole,
    created_by: actorId || null,
  });
  invalidateStaffScope(user.id);

  logger.info(`[team] ${role} ${user.email} created by ${actorId || "?"} (must change password on first login)`);
  res.status(200).json({ team: await listTeam(req) });
}
