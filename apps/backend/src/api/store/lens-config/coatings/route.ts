import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LENS_CONFIG_MODULE } from "../../../../modules/lens-config/index.js";
import type LensConfigModuleService from "../../../../modules/lens-config/service.js";
import type { UsageType } from "@eyewear/shared";

/** GET /store/lens-config/coatings?usage_type=single_vision_distance */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const lensService = req.scope.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
  const usage_type = req.query["usage_type"] as UsageType | undefined;
  const coatings = await lensService.listActiveCoatingOptions(usage_type);
  res.json({ coatings });
}
