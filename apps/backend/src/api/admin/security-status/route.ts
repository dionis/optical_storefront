import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { securityAudit } from "../../../lib/security";
import { gatherSetupFacts, tenantSecurityChecks } from "../../../lib/tenant-setup";

/**
 * GET /admin/security-status — the owner's security checklist.
 *
 * Reports presence/strength of secrets, HTTPS-only origins, Stripe mode
 * (test/live), webhook secret, notification providers… as pass/fail items.
 * Never returns a value, only whether each item is in order. Admin session
 * required (the /admin prefix is authenticated by Medusa).
 *
 * The "tenant.*" items (store profile, explicit owner, setup finished) come
 * from the database, so they are added here and not in the pure securityAudit.
 * If that read fails they are left out rather than shown as failing.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const audit = securityAudit();
  const tenantChecks = await gatherSetupFacts(req.scope).then(tenantSecurityChecks).catch(() => []);
  const checks = [...audit.checks, ...tenantChecks];
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ...audit, checks, failing: checks.filter((c) => !c.ok).length });
}
