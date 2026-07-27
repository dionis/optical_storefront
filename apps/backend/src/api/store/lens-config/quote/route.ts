import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LENS_CONFIG_MODULE } from "../../../../modules/lens-config/index";
import type LensConfigModuleService from "../../../../modules/lens-config/service";
import type { LensQuoteSelection } from "../../../../modules/lens-config/service";

/**
 * POST /store/lens-config/quote
 * Body: { frame_price_cents: number, selection: { design_code, material_code?, photo_code?, ar_code? } }
 * Returns the server-computed price breakdown (cents). The storefront NEVER sends a
 * total — this is the single source of truth for lens pricing.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const body = req.body as {
    frame_price_cents?: number;
    selection?: LensQuoteSelection;
  };

  if (
    typeof body.frame_price_cents !== "number" ||
    !body.selection ||
    typeof body.selection.design_code !== "string"
  ) {
    res.status(400).json({
      error: "Se requieren 'frame_price_cents' (número) y 'selection.design_code'.",
    });
    return;
  }

  const svc = req.scope.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
  try {
    const quote = await svc.computeQuote(body.frame_price_cents, body.selection);
    res.json({ quote });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
}
