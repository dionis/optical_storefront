import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanCreditEntry } from "../../../../lib/ai-usage";
import { createEntry } from "../../../../lib/ai-usage-data";
import { aiActor, aiHandler, AiUsageError } from "../../../../lib/ai-usage-route";
import { recordAudit } from "../../../../lib/audit";

/**
 * POST /admin/ai-usage/entries — the owner records money put into a provider:
 *   { provider, kind: "deposit" | "balance", amount_usd, effective_at?, note? }
 * "deposit" adds to the balance; "balance" sets it to what the console shows.
 * Audited with the amount.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await aiHandler(req, res, async () => {
    const actor = await aiActor(req);
    const cleaned = cleanCreditEntry((req.body ?? {}) as Record<string, unknown>);
    if ("reason" in cleaned) throw new AiUsageError(cleaned.reason);
    const id = await createEntry(req.scope, cleaned.entry, actor);
    await recordAudit(req.scope, { actorId: actor, action: "ai_credit.change", entity: "ai_credit_entry", entityId: id, after: { ...cleaned.entry, effective_at: cleaned.entry.effective_at.toISOString() } });
    res.json({ id });
  });
}
