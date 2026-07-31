import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { listCompatCoatingOptions } from "../../../../lib/lens-compat";

/**
 * GET /store/lens-config/coatings?usage_type=single_vision_distance
 *
 * Legacy contract, served from the 2026 price matrix — see src/lib/lens-compat.ts.
 * Photochromics/Transitions map to `type: "photochromic"`, anti-reflective coatings
 * to `anti_reflective` (or `blue_light` for the blue-filter ones). The matrix prices
 * no `polarized` or `tint` coating, so those types are never returned.
 *
 * Photochromic prices depend on the lens design category, which a single legacy
 * number cannot express: `price_modifier_cents` is the cheapest applicable price and
 * `price_by_category` carries the real per-category amounts.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const usage_type = req.query["usage_type"] as string | undefined;

  const coatings = await listCompatCoatingOptions(pg, usage_type);
  res.json({ coatings });
}
