import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { cleanCatalogFramePatch } from "../../../../../lib/catalog-frame";
import { deleteCatalogFrame, updateCatalogFrame } from "../../../../../lib/catalog-frame-data";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { redactMatrixRow } from "../../../../../lib/price-matrix";
import { invalidatePriceCaches, loadMatrixRow } from "../../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../../lib/price-matrix-route";

/**
 * POST /admin/catalog/frames/:id (v2, docs/PRICE-MATRIX.md «Modelos»)
 *   { model?, brand?, brand_slug?, status?: "published"|"draft",
 *     eye_size?, bridge_size?, temple_length?, images?: [url],
 *     material?, shape?, style?, gender?, age_group?, features?: [..], description?,
 *     colors?: [{ variant_id?, name, image? }] }
 *
 * Edits a frame or a case — scraped or manual — with only the keys sent. The
 * PDP attributes go to the same `product.metadata` keys the scraper writes,
 * merged (Medusa replaces metadata on update). `colors` is the WHOLE list
 * wanted: `{ variant_id, name }` keeps or renames a colour, `{ name }` adds one
 * (SKU `<model SKU>-<colour>`, the model's Medusa price), and a colour left out
 * is removed — only if it was never sold, otherwise 409 `variant_sold` with
 * `variant_ids` and nothing is written. Cost and prices are cells of the
 * matrix, not of this route.
 *
 * NOTE: the catalogue sync still owns the fields it scrapes on a Capri model
 * (title, description, attributes): an edit of a scraped model lasts until the
 * next sync rewrites them. A manual model (`metadata.source = "manual"`) is
 * never touched by the sync.
 *
 * Answers `{ product_id, row }` (`row` in the matrix GET's shape). Owner and
 * superadmin only. Reasons: `forbidden_role` (403), `product_not_found` (404),
 * `variant_sold` (409), `bad_sku` / `bad_brand` / `bad_status` /
 * `bad_measure` / `bad_colors` / `bad_images` / `bad_attribute` /
 * `bad_description` / `nothing_to_change` (422), `save_failed` (500).
 * Audited as `catalog.update`.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can edit models." });
    return;
  }
  const cleaned = cleanCatalogFramePatch((req.body ?? {}) as Record<string, unknown>);
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid model change." });
    return;
  }
  const id = String(req.params?.id ?? "");
  try {
    const out = await updateCatalogFrame(req.scope, id, cleaned.patch, access.actorId);
    if ("reason" in out) {
      const status = out.reason === "product_not_found" ? 404 : out.reason === "variant_sold" ? 409 : 422;
      res.status(status).json({ type: status === 404 ? "not_found" : status === 409 ? "conflict" : "invalid_data", reason: out.reason, variant_ids: out.variant_ids, message: "The model cannot take this change." });
      return;
    }
    invalidatePriceCaches();
    const row = await loadMatrixRow(req.scope, "frame", id, { withCosts: access.canSeeCosts });
    logger.info(`[catalog] model ${id} edited by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ product_id: id, row: row && !access.canSeeCosts ? redactMatrixRow(row) : row });
  } catch (error) {
    logger.error(`[catalog] model edit failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the model." });
  }
}

/**
 * DELETE /admin/catalog/frames/:id → { deleted: true } | { archived: true }
 *
 * Never sold (no order line, no till sale) → the product is deleted. Sold →
 * it becomes «descontinuado» (draft): it leaves the web and every till, and
 * its sales keep pointing at it. Owner and superadmin only. Reasons:
 * `forbidden_role` (403), `product_not_found` (404), `save_failed` (500).
 * Audited as `catalog.delete`.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can remove models." });
    return;
  }
  const id = String(req.params?.id ?? "");
  try {
    const out = await deleteCatalogFrame(req.scope, id, access.actorId);
    if ("reason" in out) {
      res.status(404).json({ type: "not_found", reason: out.reason, message: `No model ${id}.` });
      return;
    }
    invalidatePriceCaches();
    logger.info(`[catalog] model ${id} ${"deleted" in out ? "deleted" : "archived"} by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json(out);
  } catch (error) {
    logger.error(`[catalog] model delete failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not remove the model." });
  }
}
