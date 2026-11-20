import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getStaffScope } from "../../../lib/staff-scope";
import { webChannelSummary } from "../../../lib/web-channel";

/**
 * GET /admin/web-channel — the online store as the panel sees it (Tiendas →
 * «Tienda online»): the storefront domains this backend serves, the brand of
 * each, how many web orders arrived in the last 30 days and the last one.
 * Owner and superadmin only (`forbidden_role`, 403); no money, no customer data.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const scope = await getStaffScope(req.scope, req.auth_context?.actor_id ?? "");
  if (!scope.is_admin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can see the online store's status." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(await webChannelSummary(req.scope));
}
