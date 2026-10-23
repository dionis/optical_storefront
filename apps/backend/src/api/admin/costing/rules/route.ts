import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  CostRuleError,
  listCostRules,
  loadCostCatalog,
  seedCostRulesIfEmpty,
  upsertCostRules,
  validateCostRules,
} from "../../../../lib/costing";

/**
 * Cost rules — the owner's cost-sheet template.
 *
 *   GET /admin/costing/rules — every live rule + the catalog the panel offers
 *                              (brands, lens codes with Spanish labels). Seeds
 *                              the defaults the first time the table is empty
 *                              (`seeded: true` on that response).
 *   PUT /admin/costing/rules — upsert a batch { rules: [...] }. 400 reasons:
 *                              bad_kind, bad_amount, bad_match_key, duplicate.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  try {
    const catalog = await loadCostCatalog(req.scope);
    const seeded = await seedCostRulesIfEmpty(req.scope, catalog);
    res.json({ rules: await listCostRules(req.scope), seeded, catalog });
  } catch (error) {
    logger.error(`[costing] rules list failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "list_failed", message: "Could not list cost rules." });
  }
}

export async function PUT(req: AuthenticatedMedusaRequest<{ rules?: unknown[] }>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as { rules?: unknown[] };
  try {
    const rules = validateCostRules(Array.isArray(body.rules) ? body.rules : []);
    const saved = await upsertCostRules(req.scope, rules);
    console.info(JSON.stringify({ event: "costing.rules_saved", count: rules.length, admin_user_id: req.auth_context?.actor_id ?? null, timestamp: new Date().toISOString() }));
    res.json({ rules: saved });
  } catch (error) {
    if (error instanceof CostRuleError) {
      res.status(400).json({ type: "invalid_data", reason: error.reason, message: error.message });
      return;
    }
    logger.error(`[costing] rules save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save cost rules." });
  }
}
