import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { isAllowedForRestrictedRole } from "./staff-roles";
import { getStaffScope } from "./staff-scope";

/**
 * Role gate for every /admin route, ours and Medusa's.
 *
 * Any user Medusa authenticates gets the WHOLE native admin API — products,
 * orders, customers, settings — so a seller account without this would see and
 * edit everything. Owners and superadmins pass untouched (what every admin could
 * do before roles existed); every other role only reaches the routes
 * allowlisted in staff-roles.ts, and gets a 403 with `reason` elsewhere.
 *
 * Medusa authenticates /admin before user middlewares run, so `auth_context` is
 * already set here. Requests without a user (preflight, unauthenticated, secret
 * API keys — which only admins can mint) are left to Medusa's own handling.
 * If the role cannot be loaded the request is refused: failing open would hand
 * the full admin API to every role.
 *
 * Three arguments on purpose — see tests/middleware-arity.test.ts.
 */
export async function staffGuard(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const ctx = req.auth_context;
  if (!ctx?.actor_id || ctx.actor_type !== "user") return next();

  let scope;
  try {
    scope = await getStaffScope(req.scope, ctx.actor_id);
  } catch (error) {
    req.scope
      .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
      .error(`[staff-guard] could not resolve role for ${ctx.actor_id}: ${(error as Error).message}`);
    res.status(503).json({ type: "unexpected_state", reason: "scope_unavailable", message: "Could not resolve the user's role." });
    return;
  }

  if (scope.is_admin) return next();
  if (isAllowedForRestrictedRole(req.method, req.originalUrl ?? req.url, scope.privileges)) return next();

  res.status(403).json({
    type: "not_allowed",
    reason: scope.role ? "forbidden_role" : "inactive",
    message: "This role cannot use this admin route.",
  });
}
