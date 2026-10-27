import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import { cleanRule } from "./alerts";
import { listEstablishments } from "./establishments";
import { sellableStores } from "./pos";
import { PosError } from "./pos-data";
import type { StaffScope } from "./staff-scope";

/**
 * Who may configure alerts (permission matrix): owner and superadmins every
 * rule; a supervisor only their own rules, over their stores, and without
 * changing the frequency (that is the owner's). Nobody else.
 */
export function canConfigureAlerts(scope: StaffScope): boolean {
  return scope.is_admin || scope.role === "supervisor";
}

export async function cleanRuleFor(req: AuthenticatedMedusaRequest, scope: StaffScope, body: Record<string, unknown>) {
  const all = await listEstablishments(req.scope);
  const cleaned = cleanRule(body, {
    canSchedule: scope.is_admin,
    allowedStores: scope.is_admin ? null : sellableStores(scope, all).map((s) => s.id),
    knownStores: all.map((s) => s.id),
  });
  if ("reason" in cleaned) throw new PosError(cleaned.reason);
  return cleaned.rule;
}
