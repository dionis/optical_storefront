import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { catalogBrands } from "../../../lib/price-matrix-data";
import { getStaffScope } from "../../../lib/staff-scope";
import { cleanShowcase } from "../../../lib/web-showcase";
import { readShowcase, saveShowcase } from "../../../lib/web-showcase-data";

/**
 * «Vitrina de la tienda web» (Tiendas → Tienda online; lib/web-showcase.ts).
 *
 * GET  /admin/web-showcase
 *   → { showcase: { mode, brands, updated_at, updated_by }, brands: [{ slug, name, models, logo_url }] }
 *     `brands` = the catalogue's frame brands with at least one model, the
 *     ones the owner can choose from.
 * POST /admin/web-showcase { mode: "catalog"|"brands"|"random", brands?: string[] }
 *   → { showcase }
 *
 * Owner and superadmin only (`forbidden_role`, 403). Reasons (422): `bad_mode`,
 * `bad_brands`, `too_many_brands`, `unknown_brand`, `brands_required`;
 * `load_failed` / `save_failed` (500).
 */
async function frameBrands(req: AuthenticatedMedusaRequest) {
  const all = await catalogBrands(req.scope);
  return all
    .filter((b) => (b.kind ?? "frame") === "frame" && b.active !== false && Number(b.models) > 0)
    .map((b) => ({ slug: b.slug, name: b.name, models: Number(b.models), logo_url: b.logo_url ?? null }));
}

async function denied(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<boolean> {
  const scope = await getStaffScope(req.scope, req.auth_context?.actor_id ?? "");
  if (scope.is_admin) return false;
  res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can change the web showcase." });
  return true;
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  if (await denied(req, res)) return;
  try {
    const [showcase, brands] = await Promise.all([readShowcase(req.scope), frameBrands(req)]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ showcase, brands });
  } catch (error) {
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[web-showcase] load failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the web showcase." });
  }
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  if (await denied(req, res)) return;
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  let known: Set<string>;
  try {
    known = new Set((await frameBrands(req)).map((b) => b.slug));
  } catch (error) {
    logger.error(`[web-showcase] brands failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "load_failed", message: "Could not read the brands." });
    return;
  }
  const clean = cleanShowcase(req.body, known);
  if (!clean.ok) {
    res.status(422).json({ type: "invalid_data", reason: clean.reason, message: "Invalid web showcase." });
    return;
  }
  try {
    const showcase = await saveShowcase(req.scope, clean.value, req.auth_context?.actor_id ?? null);
    logger.info(`[web-showcase] ${showcase.mode} [${showcase.brands.join(", ")}] by ${req.auth_context?.actor_id ?? "?"}`);
    res.json({ showcase });
  } catch (error) {
    logger.error(`[web-showcase] save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the web showcase." });
  }
}
