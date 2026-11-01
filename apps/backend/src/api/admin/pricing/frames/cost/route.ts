import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../../lib/audit";
import {
  frameCostAudit,
  frameCostDenied,
  frameCostKeyOf,
  frameCostView,
  listFrameCosts,
  loadCatalogModels,
  setOwnerFrameCost,
  summarizeFrameCosts,
} from "../../../../../lib/frame-cost";
import { frameCostsDenied } from "../../../../../lib/frame-cost-route";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";

/**
 * POST /admin/pricing/frames/cost
 *   { sku, cost_cents }        → the owner's own cost for that model
 *   { sku, cost_cents: null }  → back to the supplier's list
 *
 * The one place the owner changes what a frame costs him. Setting a figure
 * marks the row «editada por el dueño», which is what stops the seeding
 * migration and the next supplier list from overwriting it; clearing it hands
 * the model back to the list (or, for a model the list does not carry, back to
 * "cost unknown" — never to 0).
 *
 * `cost_cents` is an INTEGER NUMBER OF CENTS, not dollars: the panel already
 * speaks cents for every cost and a float here is how a 19.99 becomes 19.98.
 *
 * Only with «Gestionar costos» (costs.manage; admins implicitly). Every change
 * is audited as `cost.change` on `frame_cost` with the figure before and after,
 * and the sheet mirror is refreshed in the background.
 *
 * Reasons: `bad_sku` (empty / too long), `bad_cost` (not an integer ≥ 0 in
 * cents, or above $10,000), `forbidden_role`, `save_failed`.
 */
interface Body {
  sku?: unknown;
  cost_cents?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const sku = typeof body.sku === "string" ? body.sku.trim() : body.sku;
  // An absent / empty `cost_cents` is the same ask as an explicit null: follow
  // the list again. Anything else has to be a whole number of cents.
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

  const actorId = req.auth_context?.actor_id ?? null;
  const key = frameCostKeyOf(String(sku));
  try {
    const { row, before } = await setOwnerFrameCost(req.scope, { sku: String(sku), costCents }, actorId);
    await recordAudit(req.scope, {
      actorId,
      action: "cost.change",
      entity: "frame_cost",
      entityId: key,
      before: frameCostAudit(before),
      after: frameCostAudit(row),
    });
    const [costs, catalog] = await Promise.all([listFrameCosts(req.scope), loadCatalogModels(req.scope)]);
    logger.info(`[pricing] frame cost ${key} -> ${costCents === null ? "supplier list" : `${costCents} cents`} by ${actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ cost: row ? frameCostView(row) : null, summary: summarizeFrameCosts(costs, catalog) });
  } catch (error) {
    logger.error(`[pricing] frame cost save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the frame cost." });
  }
}
