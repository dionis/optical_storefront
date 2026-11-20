import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ownerExplicitCheck } from "../../../lib/owner-explicit";
import { securityAudit } from "../../../lib/security";
import { gatherSetupFacts, tenantSecurityChecks } from "../../../lib/tenant-setup";
import { gatherWebChannelFacts, webChannelChecks } from "../../../lib/web-channel";

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
 *   - `web.*`: the online store on this backend (lib/web-channel.ts): its
 *     domains and brand, a publishable key, a way to pay, a shipping option
 *     and when its last order arrived.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const audit = securityAudit();
  const owner = await ownerExplicitCheck(req.scope);
  audit.checks.push({ key: "owner.explicit", ok: owner.ok, detail: owner.detail });
  const tenantChecks = await gatherSetupFacts(req.scope).then(tenantSecurityChecks).catch(() => []);
  audit.checks.push(...tenantChecks);
  const webChecks = await gatherWebChannelFacts(req.scope).then((f) => webChannelChecks(f)).catch(() => []);
  audit.checks.push(...webChecks);
  audit.failing = audit.checks.filter((c) => !c.ok).length;
  res.status(200).json(audit);
}
