import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanAlert } from "../../../../../lib/ai-usage";
import { deleteAlert, updateAlert } from "../../../../../lib/ai-usage-data";
import { aiActor, aiHandler, AiUsageError } from "../../../../../lib/ai-usage-route";
import { recordAudit } from "../../../../../lib/audit";

/** POST /admin/ai-usage/alerts/:id — edit a rule (re-arms it). */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await aiHandler(req, res, async () => {
    const actor = await aiActor(req);
    const cleaned = cleanAlert((req.body ?? {}) as Record<string, unknown>);
    if ("reason" in cleaned) throw new AiUsageError(cleaned.reason);
    if (!(await updateAlert(req.scope, req.params.id, cleaned.alert))) throw new AiUsageError("alert_not_found", 404);
    await recordAudit(req.scope, { actorId: actor, action: "ai_alert.change", entity: "ai_credit_alert", entityId: req.params.id, after: cleaned.alert });
    res.json({ id: req.params.id });
  });
}

/** DELETE /admin/ai-usage/alerts/:id */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await aiHandler(req, res, async () => {
    const actor = await aiActor(req);
    if (!(await deleteAlert(req.scope, req.params.id))) throw new AiUsageError("alert_not_found", 404);
    await recordAudit(req.scope, { actorId: actor, action: "ai_alert.change", entity: "ai_credit_alert", entityId: req.params.id, before: { id: req.params.id } });
    res.json({ id: req.params.id, deleted: true });
  });
}
