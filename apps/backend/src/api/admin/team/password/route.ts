import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService, IUserModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * POST /admin/team/password — el admin AUTENTICADO cambia SU contraseña.
 *
 * Es la segunda mitad del alta con contraseña temporal: el panel detecta
 * `must_change_password` (GET /admin/team/me) y no deja pasar al dashboard
 * hasta completar este cambio. Exige la contraseña actual (la temporal) para
 * que un panel abierto en otro equipo no baste para secuestrar la cuenta.
 */
interface Body {
  current_password?: string;
  new_password?: string;
}

export async function POST(
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const current = String(body.current_password ?? "");
  const next = String(body.new_password ?? "");
  const actorId = req.auth_context?.actor_id ?? "";

  if (next.length < 8) {
    res.status(422).json({ type: "invalid_data", reason: "weak_password", message: "New password must be at least 8 characters." });
    return;
  }
  if (next === current) {
    res.status(422).json({ type: "invalid_data", reason: "same_password", message: "New password must differ from the current one." });
    return;
  }

  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  const me = await users.retrieveUser(actorId).catch(() => null);
  if (!me) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "Authenticated user not found." });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const check = await auth.authenticate("emailpass", { body: { email: me.email, password: current } });
  if (!check.success) {
    res.status(401).json({ type: "unauthorized", reason: "bad_current", message: "Current password is incorrect." });
    return;
  }

  const updated = await auth.updateProvider("emailpass", { entity_id: me.email, password: next });
  if (!updated.success) {
    res.status(500).json({ type: "error", reason: "update_failed", message: updated.error || "Password update failed." });
    return;
  }

  // La temporal ya no existe: levantar el candado de primer acceso.
  const metadata = { ...((me.metadata as Record<string, unknown>) ?? {}), must_change_password: false };
  await users.updateUsers({ id: me.id, metadata });

  logger.info(`[team] ${me.email} changed their password`);
  res.json({ ok: true });
}
