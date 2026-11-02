import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../lib/audit";
import { validateSettings } from "../../../../lib/catalog-sync";
import { loadSettings, saveSettings } from "../../../../lib/catalog-sync-data";

/**
 * POST /admin/catalog-sync/settings { schedule_enabled?, schedule_day?,
 * schedule_hour?, schedule_full?, views_max_cost? }
 *
 * Partial update of the monthly schedule and of the view budget for new
 * models. Out-of-range values are refused with a `reason`, never clamped.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { settings: before } = await loadSettings(req.scope);
  const result = validateSettings(before, body);
  if ("reason" in result) {
    res.status(422).json({ type: "invalid_data", reason: result.reason, message: "Invalid catalog sync setting." });
    return;
  }
  const actorId = req.auth_context?.actor_id ?? null;
  await saveSettings(req.scope, result.value, actorId);
  await recordAudit(req.scope, {
    actorId,
    action: "settings.change",
    entity: "catalog_sync_setting",
    entityId: "default",
    before,
    after: result.value,
  });
  res.json({ settings: result.value });
}
