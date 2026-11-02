import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../../lib/establishments";
import { loadPricingOverview } from "../../../../lib/pricing-overview";

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
    res.json(await loadPricingOverview(req.scope, wanted));
  } catch (error) {
    logger.error(`[pricing] overview failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not load the pricing overview." });
  }
}
