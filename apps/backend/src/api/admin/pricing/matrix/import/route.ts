import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { applyMatrixImport, planMatrixImport } from "../../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../../lib/price-matrix-route";

/**
 * POST /admin/pricing/matrix/import
 *   { apply: false | true, rows: [{ section, sku | key, cost?, stores?: { <code>: { price?, discount? } } }] }
 *
 * The Excel book of «Productos y precios» coming back (docs/PRICE-MATRIX.md).
 * Frames and cases by `sku` (any colour's), lenses and treatments by `key`,
 * stores by their `code`. A cell ABSENT from a row is not touched; `null`
 * empties it; a cell already holding that value is not a change (so
 * re-importing the exported book changes nothing).
 *
 *   apply: false → { plan: { changes, errors, counts } }   nothing written
 *   apply: true  → { applied, failed }                      the same plan, written
 *                  only when it has no errors (422 `import_has_errors` with the
 *                  plan otherwise); audited as `price.import`, each cell as
 *                  its own `price.change` / `cost.change`.
 *
 * Owner and superadmin only; a plan that changes a cost also needs «Gestionar
 * costos». Reasons: `bad_rows`, `forbidden_role`, `import_has_errors`,
 * `save_failed`.
 */
interface Body {
  apply?: unknown;
  rows?: unknown;
}

const MAX_IMPORT_ROWS = 5000;

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can import prices." });
    return;
  }
  if (!Array.isArray(body.rows) || body.rows.length > MAX_IMPORT_ROWS) {
    res.status(422).json({ type: "invalid_data", reason: "bad_rows", message: `rows must be a list of at most ${MAX_IMPORT_ROWS}.` });
    return;
  }
  try {
    const ctx = await planMatrixImport(req.scope, body.rows);
    if (ctx.plan.counts.cost > 0 && !access.canManageCosts) {
      res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Costs need the costs.manage privilege." });
      return;
    }
    if (body.apply !== true) {
      res.json({ plan: ctx.plan });
      return;
    }
    if (ctx.plan.errors.length) {
      res.status(422).json({ type: "invalid_data", reason: "import_has_errors", message: "Fix the rows with errors first.", plan: ctx.plan });
      return;
    }
    const { applied, failed } = await applyMatrixImport(req.scope, ctx, access.actorId);
    logger.info(`[price-matrix] import: ${applied} cells written, ${failed.length} refused, by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ applied, failed });
  } catch (error) {
    logger.error(`[price-matrix] import failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not import the prices." });
  }
}
