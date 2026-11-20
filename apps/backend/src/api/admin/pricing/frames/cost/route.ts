import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../../lib/audit";
import {
  frameCostAudit,
  frameCostDenied,
  frameCostKeyOf,
  frameCostStoreRows,
  frameCostStoreView,
  frameCostVariationAudit,
  indexFrameCostVariations,
  listFrameCostVariations,
  listFrameCosts,
  loadCatalogModels,
  resolveFrameCost,
  setOwnerFrameCost,
  setStoreFrameCost,
  summarizeFrameCosts,
} from "../../../../../lib/frame-cost";
import { frameCostsDenied } from "../../../../../lib/frame-cost-route";
import { queueCostMultiples } from "../../../../../lib/cost-multiple";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { resolvePricingStore } from "../../../../../lib/pricing-overview";

/**
 * POST /admin/pricing/frames/cost
 *
 *   { sku, cost_cents }                     → the chain's cost (THE MASTER)
 *   { sku, cost_cents: null }               → the master back to the supplier's list
 *   { sku, cost_cents, store }              → what THAT store pays (its variation)
 *   { sku, cost_cents: null, store }        → remove the variation; the store inherits again
 *
 * The one place the owner changes what a frame costs him, in both halves of his
 * own sentence: «los costos se aplican a todas las tiendas, pero cada tienda
 * maneja sus costos por separado».
 *
 * `store` reads like everywhere else in the pricing panel (absent / "all" /
 * "web" = the master, see lib/pricing-overview.ts). On the MASTER, setting a
 * figure marks the row «editada por el dueño», which is what stops the seeding
 * migration and the next supplier list from overwriting it; clearing it hands
 * the model back to the list (or, for a model the list does not carry, back to
 * "cost unknown" — never to 0). On a STORE, setting creates or moves that
 * store's own row and clearing DELETES it, which is how the model goes back to
 * inheriting the master instead of pretending to cost nothing. Editing one
 * never touches the other.
 *
 * `cost_cents` is an INTEGER NUMBER OF CENTS, not dollars: the panel already
 * speaks cents for every cost and a float here is how a 19.99 becomes 19.98.
 *
 * Only with «Gestionar costos» (costs.manage; admins implicitly). Every change
 * is audited as `cost.change` on `frame_cost` with the figure before and after
 * and, for a variation, the store on the event itself. The sheet mirror is
 * refreshed in the background.
 *
 * Reasons: `bad_sku` (empty / too long), `bad_cost` (not an integer ≥ 0 in
 * cents, or above $10,000), `store_not_found`, `forbidden_role`, `save_failed`.
 */
interface Body {
  sku?: unknown;
  cost_cents?: unknown;
  store?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const sku = typeof body.sku === "string" ? body.sku.trim() : body.sku;
  // An absent / empty `cost_cents` is the same ask as an explicit null: follow
  // the layer above again. Anything else has to be a whole number of cents.
  const raw = body.cost_cents;
  const costCents = raw === null || raw === undefined || raw === "" ? null : Number(raw);

  const notAllowed = await frameCostsDenied(req, "write");
  if (notAllowed) {
    res.status(403).json({ type: "not_allowed", reason: notAllowed, message: "Costs cannot be changed by this user." });
    return;
  }
  const denied = frameCostDenied(sku, costCents);
  if (denied) {
    res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid frame cost." });
    return;
  }
  const scope = await resolvePricingStore(req.scope, body.store);
  if ("reason" in scope) {
    res.status(422).json({ type: "invalid_data", reason: scope.reason, message: "Unknown store." });
    return;
  }
  const storeId = scope.storeId;

  const actorId = req.auth_context?.actor_id ?? null;
  const key = frameCostKeyOf(String(sku));
  try {
    if (storeId) {
      const { row, before } = await setStoreFrameCost(req.scope, { storeId, sku: String(sku), costCents }, actorId);
      await recordAudit(req.scope, {
        actorId,
        action: "cost.change",
        entity: "frame_cost",
        entityId: key,
        establishmentId: storeId,
        before: frameCostVariationAudit(before),
        after: frameCostVariationAudit(row),
      });
      logger.info(
        `[pricing] frame cost ${key} @ ${storeId} -> ${costCents === null ? "master" : `${costCents} cents`} by ${actorId ?? "?"}`
      );
    } else {
      const { row, before } = await setOwnerFrameCost(req.scope, { sku: String(sku), costCents }, actorId);
      await recordAudit(req.scope, {
        actorId,
        action: "cost.change",
        entity: "frame_cost",
        entityId: key,
        before: frameCostAudit(before),
        after: frameCostAudit(row),
      });
      logger.info(
        `[pricing] frame cost ${key} -> ${costCents === null ? "supplier list" : `${costCents} cents`} by ${actorId ?? "?"}`
      );
    }

    // A store priced at «N × costo» follows the cost that just changed.
    queueCostMultiples(req.scope);

    // Read the scope back the way the panel reads it, so the row it gets is
    // the EFFECTIVE one (and, after removing a variation, the master's figure
    // rather than nothing at all).
    const [costs, catalog, variations] = await Promise.all([
      listFrameCosts(req.scope),
      loadCatalogModels(req.scope),
      listFrameCostVariations(req.scope, storeId).catch(() => []),
    ]);
    const index = indexFrameCostVariations(variations);
    const resolved = resolveFrameCost(new Map(costs.map((c) => [c.sku, c])), index, key, storeId);
    void mirrorPricesToSheet(req.scope);
    res.json({
      store: storeId,
      cost: resolved ? frameCostStoreView(resolved) : null,
      summary: summarizeFrameCosts(costs, catalog, index, storeId),
      // The whole list, already resolved for this scope: saving one cost is
      // also the moment the panel refreshes, and it would otherwise ask again.
      costs: frameCostStoreRows(costs, index, storeId).map(frameCostStoreView),
    });
  } catch (error) {
    logger.error(`[pricing] frame cost save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the frame cost." });
  }
}
