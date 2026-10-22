import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { securityAudit } from "../../../lib/security";

/**
 * GET /admin/security-status — the owner's security checklist.
 *
 * Reports presence/strength of secrets, HTTPS-only origins, Stripe mode
 * (test/live), webhook secret, notification providers… as pass/fail items.
 * Never returns a value, only whether each item is in order. Admin session
 * required (the /admin prefix is authenticated by Medusa).
 */
export async function GET(_req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(securityAudit());
}
