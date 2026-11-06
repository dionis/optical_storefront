import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../../lib/establishments";
import { loadPricingOverview, redactLensCosts } from "../../../../lib/pricing-overview";
import { hasPrivilege } from "../../../../lib/staff-profile";
import { getStaffScope } from "../../../../lib/staff-scope";

/**
 * GET /admin/pricing/overview?store=<id|all>
 *
 * ONE payload for the whole "Precios y costos" panel: the frame / case rules
 * and the models whose price the owner changed by hand, the lens matrix with
 * the photochromic and AR tables, the commissions, the cost rules with their
 * per-store switch, the store's fixed and variable costs and the tax rate.
 *
 * `store` absent or "all" (or "web", which is not an establishment) = THE
 * MASTER. A store id = the master and that store's variations side by side, so
 * the panel can badge every inherited value.
 *
 * Owner and superadmin only. There is no allow-list entry for this route in
 * lib/staff-roles.ts, and lib/staff-guard.ts refuses every /admin route it does
 * not list for a non-admin role — the same deny-by-default that already guards
 * /admin/store-pricing and /admin/costing. Errors carry a `reason`; the panel
 * turns it into adm.err.pricing.<reason>.
 *
 * The lens cells' lab cost (`lenses.base[].cost_cents`) leaves only for a
 * reader with «Ver costos» / «Gestionar costos» (admins implicitly); for anyone
 * else it is removed here, on the server (`redactLensCosts`).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const raw = String((req.query as Record<string, string | undefined>).store ?? "").trim();
  const wanted = raw && raw !== "all" && raw !== "web" ? raw : null;
  try {
    if (wanted && !(await listEstablishments(req.scope)).some((e) => e.id === wanted)) {
      res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
      return;
    }
    const overview = await loadPricingOverview(req.scope, wanted);
    const actorId = req.auth_context?.actor_id;
    const scope = actorId ? await getStaffScope(req.scope, actorId) : null;
    const canSeeCosts = Boolean(scope && (hasPrivilege(scope, "costs.view") || hasPrivilege(scope, "costs.manage")));
    res.json({ ...overview, lenses: redactLensCosts(overview.lenses, canSeeCosts) });
  } catch (error) {
    logger.error(`[pricing] overview failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not load the pricing overview." });
  }
}
