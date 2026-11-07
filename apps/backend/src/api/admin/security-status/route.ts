import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ownerExplicitCheck } from "../../../lib/owner-explicit";
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
 * Read from the database, so added here and not in the pure securityAudit:
 *   - `owner.explicit`: the owner is named by a transfer from the panel
 *     (store_setting.owner_user_id) or by the deploy (STORE_OWNER_EMAIL), not
 *     only "the oldest user" (lib/owner-explicit.ts). No email shown.
 *   - `tenant.*`: store profile complete and setup finished (lib/tenant-setup.ts);
 *     left out when that read fails rather than shown as failing.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const audit = securityAudit();
  const owner = await ownerExplicitCheck(req.scope);
  audit.checks.push({ key: "owner.explicit", ok: owner.ok, detail: owner.detail });
  const tenantChecks = await gatherSetupFacts(req.scope).then(tenantSecurityChecks).catch(() => []);
  audit.checks.push(...tenantChecks);
  audit.failing = audit.checks.filter((c) => !c.ok).length;
  res.status(200).json(audit);
}
