import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { securityAudit } from "../../../lib/security";
import { configuredOwnerEmail } from "../../../lib/staff-roles";
import { storedOwnerUserId } from "../../../lib/store-settings";

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
  // The owner is named explicitly: by a transfer from the panel
  // (store_setting.owner_user_id, which wins) or by the deploy
  // (STORE_OWNER_EMAIL), and that user exists; otherwise the oldest user is the
  // owner by default (lib/staff-scope.ts ownerUserId). No email shown.
  const want = configuredOwnerEmail();
  let ownerOk = false;
  try {
    const users = req.scope.resolve<IUserModuleService>(Modules.USER);
    const named = await storedOwnerUserId(req.scope).catch(() => null);
    if (named) ownerOk = (await users.listUsers({ id: [named] }, { take: 1, select: ["id"] })).length > 0;
    if (!ownerOk && want) {
      const all = await users.listUsers({}, { take: 1000, select: ["id", "email"] });
      ownerOk = all.some((u) => String(u.email ?? "").trim().toLowerCase() === want);
    }
  } catch {
    ownerOk = false;
  }
  audit.checks.push({ key: "owner.explicit", ok: ownerOk, detail: ownerOk ? "" : want ? "no_user" : "unset" });
  audit.failing = audit.checks.filter((c) => !c.ok).length;
  res.status(200).json(audit);
}
