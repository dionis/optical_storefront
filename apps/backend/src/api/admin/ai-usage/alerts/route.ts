import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanAlert } from "../../../../lib/ai-usage";
import { createAlert } from "../../../../lib/ai-usage-data";
import { aiActor, aiHandler, AiUsageError } from "../../../../lib/ai-usage-route";
import { recordAudit } from "../../../../lib/audit";

/**
 * POST /admin/ai-usage/alerts — a low-balance rule:
 *   { provider, unit: "usd" | "percent" | "days", threshold, recipients?, locale?, is_active? }
 * No recipients = the store's admin notification list.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await aiHandler(req, res, async () => {
    const actor = await aiActor(req);
    const cleaned = cleanAlert((req.body ?? {}) as Record<string, unknown>);
    if ("reason" in cleaned) throw new AiUsageError(cleaned.reason);
    const id = await createAlert(req.scope, cleaned.alert, actor);
    await recordAudit(req.scope, { actorId: actor, action: "ai_alert.change", entity: "ai_credit_alert", entityId: id, after: cleaned.alert });
    res.json({ id });
  });
}
