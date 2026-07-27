import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LENS_CONFIG_MODULE } from "../../../../modules/lens-config/index";
import type LensConfigModuleService from "../../../../modules/lens-config/service";

/**
 * GET /store/lens-config/matrix
 * The full editable 2026 price list (designs × materials base matrix + photochromic
 * + AR options) that drives the storefront lens wizard. Read-only; prices are
 * always recomputed server-side via /store/lens-config/quote.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const svc = req.scope.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
  const matrix = await svc.getMatrix();
  res.json(matrix);
}
