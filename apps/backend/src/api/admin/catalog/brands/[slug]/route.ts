import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { cleanBrandPatch } from "../../../../../lib/catalog-brand";
import { deleteBrand, updateBrand } from "../../../../../lib/catalog-brand-data";
import { matrixAccess } from "../../../../../lib/price-matrix-route";

const slugOf = (req: AuthenticatedMedusaRequest): string => String(req.params?.slug ?? "").trim().toLowerCase();

/**
 * POST /admin/catalog/brands/:slug { name?, logo_url?, active?, sort?, kind? } → { brand }
 *
 * Changes only the fields sent (docs/PRICE-MATRIX.md v2 «Marcas»). A brand
 * the catalogue carries but the registry does not is registered first. The
 * new name is the label of the brand's group in the matrix; the products'
 * own `metadata.brand` is not rewritten. Owner and superadmin only. Reasons:
 * `forbidden_role` (403), `brand_not_found` (404), `bad_name` / `bad_logo` /
 * `bad_kind` / `bad_value` / `nothing_to_change` (422), `save_failed` (500).
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can edit brands." });
    return;
  }
  const cleaned = cleanBrandPatch((req.body ?? {}) as Record<string, unknown>);
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid brand change." });
    return;
  }
  const slug = slugOf(req);
  try {
    const out = await updateBrand(req.scope, slug, cleaned.patch, access.actorId);
    if ("reason" in out) {
      res.status(404).json({ type: "not_found", reason: out.reason, message: `No brand ${slug}.` });
      return;
    }
    logger.info(`[catalog] brand ${slug} updated (${Object.keys(cleaned.patch).join(", ")}) by ${access.actorId ?? "?"}`);
    res.json({ brand: out.brand });
  } catch (error) {
    logger.error(`[catalog] brand update failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the brand." });
  }
}

/**
 * DELETE /admin/catalog/brands/:slug → { deleted: true }
 *
 * Only a brand with no model left (any status — a discontinued model still
 * belongs to it). Owner and superadmin only. Reasons: `forbidden_role` (403),
 * `brand_not_found` (404), `brand_has_models` (409, with `models`),
 * `save_failed` (500).
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can remove brands." });
    return;
  }
  const slug = slugOf(req);
  try {
    const out = await deleteBrand(req.scope, slug, access.actorId);
    if ("reason" in out) {
      const status = out.reason === "brand_has_models" ? 409 : 404;
      res.status(status).json({ type: status === 409 ? "conflict" : "not_found", reason: out.reason, models: out.models, message: `Brand ${slug} cannot be removed.` });
      return;
    }
    logger.info(`[catalog] brand ${slug} removed by ${access.actorId ?? "?"}`);
    res.json(out);
  } catch (error) {
    logger.error(`[catalog] brand delete failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not remove the brand." });
  }
}
