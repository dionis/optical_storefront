import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { cleanNewBrand } from "../../../../lib/catalog-brand";
import { createBrand } from "../../../../lib/catalog-brand-data";
import { catalogBrands } from "../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../lib/price-matrix-route";

/**
 * GET /admin/catalog/brands
 *   → { brands: [{ slug, name, models, logo_url, kind, active, source, sort, registered }] }
 *
 * v2 (docs/PRICE-MATRIX.md «Marcas»): the brand registry (`catalog_brand`)
 * merged with the catalogue — every registered brand with its number of listed
 * models (published + draft), plus every brand some model carries that the
 * registry lacked (registered on this very read, so it never vanishes), plus
 * the known brands with no model yet. `logo_url` is an absolute URL (an
 * upload) or a path on the panel's origin (`/brands/logo-<file>.png`, served
 * by the storefront): the panel uses it as is. Sorted by `sort`, then name.
 * Reasons: `load_failed`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    res.json({ brands: await catalogBrands(req.scope) });
  } catch (error) {
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[catalog] brands failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the brands." });
  }
}

/**
 * POST /admin/catalog/brands { name, kind?: "frame"|"case", logo_url?, slug?, sort? }
 *   → 201 { brand }
 *
 * A brand the owner adds (`source: "manual"`); the slug is derived from the
 * name when absent. Its models are then added with «Añadir montura»
 * (`POST /admin/catalog/frames` with this `brand_slug`). Owner and superadmin
 * only. Reasons: `forbidden_role` (403), `bad_name` / `bad_kind` / `bad_slug`
 * / `bad_logo` / `bad_value` (422), `brand_taken` (409), `save_failed` (500).
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can add brands." });
    return;
  }
  const cleaned = cleanNewBrand((req.body ?? {}) as Record<string, unknown>);
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid brand." });
    return;
  }
  try {
    const created = await createBrand(req.scope, cleaned.brand, access.actorId);
    if ("reason" in created) {
      res.status(409).json({ type: "conflict", reason: created.reason, message: `Brand ${cleaned.brand.slug} already exists.` });
      return;
    }
    logger.info(`[catalog] brand ${cleaned.brand.slug} created by ${access.actorId ?? "?"}`);
    res.status(201).json({ brand: created.brand });
  } catch (error) {
    logger.error(`[catalog] brand create failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not create the brand." });
  }
}
