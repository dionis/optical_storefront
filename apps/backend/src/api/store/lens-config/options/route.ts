import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LENS_CONFIG_MODULE } from "../../../../modules/lens-config/index";
import type LensConfigModuleService from "../../../../modules/lens-config/service";
import type { UsageType } from "@eyewear/shared";

/** GET /store/lens-config/options?usage_type=single_vision_distance */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const lensService = req.scope.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
  const usage_type = req.query["usage_type"] as UsageType | undefined;
  const options = await lensService.listActiveLensOptions(usage_type);
  res.json({ options });
}
