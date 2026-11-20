import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../lib/audit";
import { mirrorPricesToSheet } from "../../../../lib/gsheet-sync";
import { loadPricingOverview } from "../../../../lib/pricing-overview";
import { resolveStoreSettings, STORE_SETTING_ID } from "../../../../lib/store-settings";
import { STORE_SETTINGS_MODULE } from "../../../../modules/store-settings";
import type StoreSettingsModuleService from "../../../../modules/store-settings/service";

/**
 * POST /admin/pricing/taxes { rate_pct }
 *
 * The sales-tax rate of FRAME-ONLY purchases (prescription eyewear is tax
 * exempt), so the owner finds it next to the prices and the costs instead of
 * inside the technical settings. Stored as the decimal string
 * `store_setting.frame_tax_rate` ("0.07" for 7 %) that the point of sale and
 * the checkout already read.
 *
 * Only that column is touched: POST /admin/store-settings replaces the whole
 * row (every field it is not sent becomes null), which would wipe the owner's
 * notification emails from a pricing screen.
 */
interface Body {
  rate_pct?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const pct = Number(body.rate_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
    res.status(422).json({ type: "invalid_data", reason: "bad_value", message: "The tax rate must be 0–50 %." });
    return;
  }

  const actorId = req.auth_context?.actor_id ?? null;
  try {
    const before = await resolveStoreSettings(req.scope);
    const svc = req.scope.resolve<StoreSettingsModuleService>(STORE_SETTINGS_MODULE);
    const existing = (await svc.listStoreSettings({ id: STORE_SETTING_ID })) as unknown as Record<string, unknown>[];
    // Four decimals: 7.25 % is "0.0725", which is as fine as a US rate gets.
    const value = String(Math.round((pct / 100) * 1e6) / 1e6);
    if (existing[0]) {
      await svc.updateStoreSettings({ id: STORE_SETTING_ID, frame_tax_rate: value, updated_by: actorId });
    } else {
      await svc.createStoreSettings({ id: STORE_SETTING_ID, frame_tax_rate: value, updated_by: actorId });
    }
    await recordAudit(req.scope, {
      actorId,
      action: "settings.change",
      entity: "store_setting",
      entityId: "frame_tax_rate",
      before: { rate_pct: Math.round(before.frame_tax_rate * 10000) / 100 },
      after: { rate_pct: Math.round(pct * 100) / 100 },
    });
    const overview = await loadPricingOverview(req.scope, null);
    logger.info(`[pricing] frame tax rate -> ${pct}% by ${actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ costs: overview.costs });
  } catch (error) {
    logger.error(`[pricing] tax save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the tax rate." });
  }
}
