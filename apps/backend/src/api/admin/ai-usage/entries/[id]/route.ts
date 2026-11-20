import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { deleteEntry } from "../../../../../lib/ai-usage-data";
import { aiActor, aiHandler, AiUsageError } from "../../../../../lib/ai-usage-route";
import { recordAudit } from "../../../../../lib/audit";

/** DELETE /admin/ai-usage/entries/:id — removes a mistaken entry (soft delete, audited). */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await aiHandler(req, res, async () => {
    const actor = await aiActor(req);
    const removed = await deleteEntry(req.scope, req.params.id);
    if (!removed) throw new AiUsageError("entry_not_found", 404);
    await recordAudit(req.scope, { actorId: actor, action: "ai_credit.change", entity: "ai_credit_entry", entityId: removed.id, before: removed });
    res.json({ id: removed.id, deleted: true });
  });
}
