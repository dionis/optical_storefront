import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { planCellWrite, redactMatrixCosts, redactMatrixRow, type ItemKind } from "../../../../../lib/price-matrix";
import { brandExists, executeCellOp, invalidatePriceCaches, loadBrandGroup, loadMatrixRow, loadMatrixStores } from "../../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../../lib/price-matrix-route";

/**
 * POST /admin/pricing/matrix/cell
 *   { kind: "frame"|"case"|"lens"|"photo"|"ar", key, field: "cost"|"price"|"discount", store?, value }
 *
 * One cell of «Productos y precios» (docs/PRICE-MATRIX.md). `value` in dollars
 * for cost / price, a percentage for discount; null or "" empties the cell:
 *
 *   cost      the article's one cost (no `store`): frame / case → store_frame_cost
 *             (owner_edit; empty = back to the supplier's list), lens cell /
 *             photochromic / AR → the lab cost on the master list (empty = unknown)
 *   price     that store's exact price (frame / case: a store_price_rule
 *             override; lens / treatment: its lens_store_price cell); empty =
 *             back to the rule
 *   discount  that store's promotion on the article (store_item_discount, 0–90);
 *             empty or 0 = none
 *
 * Every write goes through the writer the rest of the pricing panel uses, is
 * audited (`price.change` / `cost.change` with before and after), drops the
 * price and cost caches and refreshes the sheet in the background. Answers
 * `{ row }` in the GET's shape so the screen repaints the row alone.
 *
 * v2 — `kind: "brand"`, `key: <slug>`, `field: "price"|"discount"`, `store`
 * (and optionally `scope: "frame"|"case"`, default case for the case brand):
 * the store's price for every model of the brand (`store_price_rule` on
 * `brand:<slug>`) or its brand discount (`store_item_discount` kind `brand`).
 * Precedence: the model's exact price / discount still wins. Answers
 * `{ group }` — the brand's group in the GET's shape (header with
 * `stores[est].brand_price_cents` / `brand_discount_pct`, every row
 * re-priced) — instead of `{ row }`. A brand has no cost (`bad_field`).
 *
 * Owner and superadmin only; a cost also needs «Gestionar costos» (admins
 * hold it). Reasons: `bad_kind`, `bad_field`, `bad_value`, `store_required`,
 * `store_not_allowed`, `store_not_found`, `unknown_item`, `discount_range`,
 * `forbidden_role`, `save_failed`.
 */
interface Body {
  kind?: unknown;
  key?: unknown;
  field?: unknown;
  store?: unknown;
  value?: unknown;
  scope?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const access = await matrixAccess(req);
  if (!access.isAdmin || (body.field === "cost" && !access.canManageCosts)) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can change the matrix." });
    return;
  }
  const planned = planCellWrite({ kind: body.kind, key: body.key, field: body.field, store: body.store, value: body.value, scope: body.scope });
  if ("reason" in planned) {
    res.status(422).json({ type: "invalid_data", reason: planned.reason, message: "Invalid matrix cell." });
    return;
  }
  const { op } = planned;
  try {
    const stores = await loadMatrixStores(req.scope);
    if ("storeId" in op && !stores.some((s) => s.id === op.storeId)) {
      res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
      return;
    }
    if (op.op === "brand_price" || op.op === "brand_discount") {
      if (!(await brandExists(req.scope, op.slug))) {
        res.status(422).json({ type: "invalid_data", reason: "unknown_item", message: `No brand ${op.slug}.` });
        return;
      }
      await executeCellOp(req.scope, op, null, access.actorId);
      invalidatePriceCaches();
      const scope = op.op === "brand_price" ? op.scope : body.scope === "case" || body.scope === "frame" ? body.scope : op.slug === "case" || op.slug === "cases" ? "case" : "frame";
      const group = await loadBrandGroup(req.scope, op.slug, scope, { withCosts: access.canSeeCosts, stores });
      logger.info(`[price-matrix] brand ${op.slug} ${op.op} @ ${op.storeId} by ${access.actorId ?? "?"}`);
      void mirrorPricesToSheet(req.scope);
      res.json({ group: group ? redactMatrixCosts([group], access.canSeeCosts)[0] : null });
      return;
    }
    const kind = body.kind as ItemKind;
    const key = String(body.key).trim();
    const row = await loadMatrixRow(req.scope, kind, key, { withCosts: true, stores });
    if (!row) {
      res.status(422).json({ type: "invalid_data", reason: "unknown_item", message: `No ${kind} ${key}.` });
      return;
    }
    const failed = await executeCellOp(req.scope, op, row, access.actorId);
    if (failed) {
      res.status(422).json({ type: "invalid_data", reason: failed, message: "The article cannot take this value." });
      return;
    }
    invalidatePriceCaches();
    const fresh = await loadMatrixRow(req.scope, kind, row.key, { withCosts: access.canSeeCosts, stores });
    logger.info(`[price-matrix] ${kind} ${row.key} ${op.op} ${"storeId" in op ? `@ ${op.storeId} ` : ""}by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ row: fresh && !access.canSeeCosts ? redactMatrixRow(fresh) : fresh });
  } catch (error) {
    logger.error(`[price-matrix] cell save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the cell." });
  }
}
