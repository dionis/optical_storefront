import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { listCompatLensOptions } from "../../../../lib/lens-compat";

/**
 * GET /store/lens-config/options?usage_type=single_vision_distance
 *
 * Legacy contract, served from the 2026 price matrix — see src/lib/lens-compat.ts.
 * Each row keeps the legacy fields (usage_type, index, label, price_modifier_cents)
 * and adds the matrix `design_code` / `material_code` so consumers can migrate to
 * the /matrix + /quote contract incrementally.
 *
 * `price_modifier_cents` is the price of the LENS, to be added to the frame price.
 * It is an estimate for display only: the authoritative total comes from
 * POST /store/lens-config/price or /quote, never from this list.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const usage_type = req.query["usage_type"] as string | undefined;

  const options = await listCompatLensOptions(pg, usage_type);
  res.json({ options });
}
