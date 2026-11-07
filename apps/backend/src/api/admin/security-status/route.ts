import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { securityAudit } from "../../../lib/security";
import { configuredOwnerEmail } from "../../../lib/staff-roles";

/**
 * GET /admin/security-status — the owner's security checklist.
 *
 * Reports presence/strength of secrets, HTTPS-only origins, Stripe mode
 * (test/live), webhook secret, notification providers… as pass/fail items.
 * Never returns a value, only whether each item is in order. Admin session
 * required (the /admin prefix is authenticated by Medusa).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const audit = securityAudit();
  // The owner named by the deploy (STORE_OWNER_EMAIL) and a user with that login
  // exists; otherwise the oldest user is the owner (lib/staff-scope.ts). No email shown.
  const want = configuredOwnerEmail();
  let ownerOk = false;
  if (want) {
    try {
      const users = await req.scope.resolve<IUserModuleService>(Modules.USER).listUsers({}, { take: 1000, select: ["id", "email"] });
      ownerOk = users.some((u) => String(u.email ?? "").trim().toLowerCase() === want);
    } catch {
      ownerOk = false;
    }
  }
  audit.checks.push({ key: "owner.explicit", ok: ownerOk, detail: want ? (ownerOk ? "" : "no_user") : "unset" });
  audit.failing = audit.checks.filter((c) => !c.ok).length;
  res.status(200).json(audit);
}
