// @ts-nocheck
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LENS_CONFIG_MODULE } from "../../../modules/lens-config/index.js";
import type LensConfigModuleService from "../../../modules/lens-config/service.js";
import type { LensConfig } from "@eyewear/shared";

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const lensConfigService = req.scope.resolve<LensConfigModuleService>(
    LENS_CONFIG_MODULE
  );

  const body = req.body as {
    frame_price_cents: number;
    lens_config: LensConfig;
  };

  if (
    typeof body.frame_price_cents !== "number" ||
    !body.lens_config
  ) {
    res
      .status(400)
      .json({ error: "Se requieren 'frame_price_cents' y 'lens_config'." });
    return;
  }

  const result = await lensConfigService.computePrice(
    body.frame_price_cents,
    body.lens_config
  );

  res.json(result);
}
