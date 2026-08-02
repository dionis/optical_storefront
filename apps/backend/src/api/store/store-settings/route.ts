import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { resolveStoreSettings } from "../../../lib/store-settings";

/**
 * GET /store/store-settings — public, storefront-facing configuration.
 *
 * Exposes ONLY what the storefront needs (the active payment provider). The
 * owner's notification email/phone are private and never returned here.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const settings = await resolveStoreSettings(req.scope);
  res.json({
    payment_provider: settings.active_payment_provider,
  });
}
