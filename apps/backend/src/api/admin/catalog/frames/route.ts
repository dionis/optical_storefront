import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { cleanCatalogFrame, handleOfSku } from "../../../../lib/catalog-frame";
import { mirrorPricesToSheet } from "../../../../lib/gsheet-sync";
import { redactMatrixRow } from "../../../../lib/price-matrix";
import { createCatalogFrame, loadMatrixRow, loadMatrixStores } from "../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../lib/price-matrix-route";

/**
 * POST /admin/catalog/frames (HU-07)
 *   { kind: "frame"|"case", brand, brand_slug?, sku, model?, colors: [{ name, image? }],
 *     eye_size?, bridge_size?, temple_length?, cost?, prices?: { <store id>: { price?, discount? } } }
 *
 * The owner adds a model by hand — a new brand is simply a `brand` no model
 * carries yet (`brand_slug` derived from the name when absent). Created the
 * way the scraper creates one (lib/catalog-frame.ts): «Color» option, one
 * variant per colour, no inventory, published, in the default sales channel
 * AND every store's, `metadata.source = "manual"` + `first_seen_at`; Medusa
 * base price = `sellingPrice(cost)`. Then, with the matrix's own writers: the
 * cost (store_frame_cost, owner_edit) and each store's price and discount.
 * The catalogue sync never drafts nor overwrites a manual model.
 *
 * Answers 201 `{ product_id, handle, row }` (`row` in the matrix GET's shape).
 * Owner and superadmin only; a cost also needs «Gestionar costos». Reasons:
 * `bad_kind`, `bad_brand`, `bad_sku`, `sku_taken`, `bad_colors`,
 * `bad_measure`, `bad_value`, `discount_range`, `store_not_found`,
 * `forbidden_role`, `save_failed`.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const access = await matrixAccess(req);
  const wantsCost = body["cost"] != null && body["cost"] !== "";
  if (!access.isAdmin || (wantsCost && !access.canManageCosts)) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can add models." });
    return;
  }
  const cleaned = cleanCatalogFrame(body);
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid model." });
    return;
  }
  const { frame } = cleaned;
  try {
    const stores = await loadMatrixStores(req.scope);
    if (Object.keys(frame.prices).some((id) => !stores.some((s) => s.id === id))) {
      res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
      return;
    }
    const created = await createCatalogFrame(req.scope, frame, access.actorId);
    if ("reason" in created) {
      res.status(409).json({ type: "conflict", reason: created.reason, message: `SKU ${frame.sku} is already in the catalogue.` });
      return;
    }
    const row = await loadMatrixRow(req.scope, frame.kind, created.product_id, { withCosts: access.canSeeCosts, stores });
    logger.info(`[catalog] manual ${frame.kind} ${frame.sku} (${frame.brand_slug}) created as ${created.product_id} by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.status(201).json({ product_id: created.product_id, handle: handleOfSku(frame.sku), row: row && !access.canSeeCosts ? redactMatrixRow(row) : row });
  } catch (error) {
    logger.error(`[catalog] manual model failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not create the model." });
  }
}
