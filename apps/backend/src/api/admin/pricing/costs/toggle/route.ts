import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { loadPricingOverview, resolvePricingStore } from "../../../../../lib/pricing-overview";
import { setCostToggle, toggleDenied, type ToggleKind } from "../../../../../lib/store-cost-toggle";

/**
 * POST /admin/pricing/costs/toggle
 *   { kind: "rule" | "cost", ref_id, store, enabled }
 *
 * "Each store can also enable/disable costs." `kind` "rule" switches a cost
 * rule of the owner's template (`ref_id` = the rule's id, or
 * "<kind>:<match_key>"); "cost" switches one of the store's fixed / variable
 * cost items. A switch always belongs to a store — the master has no switches,
 * there a rule is simply active or not — so `store` is required.
 */
interface Body {
  kind?: unknown;
  ref_id?: unknown;
  store?: unknown;
  enabled?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;

  const denied = toggleDenied(body.kind, body.ref_id, body.enabled);
  if (denied) {
    res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid cost switch." });
    return;
  }
  const store = await resolvePricingStore(req.scope, body.store);
  if ("reason" in store) {
    res.status(404).json({ type: "not_found", reason: store.reason, message: "Store not found." });
    return;
  }
  if (!store.storeId) {
    res.status(422).json({ type: "invalid_data", reason: "store_required", message: "A cost switch belongs to one store." });
    return;
  }

  const actorId = req.auth_context?.actor_id ?? null;
  try {
    await setCostToggle(
      req.scope,
      {
        establishmentId: store.storeId,
        kind: body.kind as ToggleKind,
        refId: String(body.ref_id).trim(),
        enabled: body.enabled === true,
      },
      actorId
    );
    const overview = await loadPricingOverview(req.scope, store.storeId);
    logger.info(
      `[pricing] cost ${String(body.kind)} ${String(body.ref_id)} ${body.enabled === true ? "on" : "off"} in ${store.storeId} by ${actorId ?? "?"}`
    );
    void mirrorPricesToSheet(req.scope);
    res.json({ costs: overview.costs });
  } catch (error) {
    logger.error(`[pricing] cost toggle failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the cost switch." });
  }
}
