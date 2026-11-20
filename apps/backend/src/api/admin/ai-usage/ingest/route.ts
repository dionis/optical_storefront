import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAiUsage } from "../../../../lib/ai-usage-data";
import { aiActor, aiHandler, AiUsageError } from "../../../../lib/ai-usage-route";

/**
 * POST /admin/ai-usage/ingest — usage reported by processes outside this
 * backend (the scraper's translations), with the scraper's secret API key:
 *   { events: [{ provider, model, activity, input_tokens?, output_tokens?, cost_usd?, event_key?, ref_id?, status? }] }
 * Each event is cleaned and priced like the backend's own (ai-usage.ts); a
 * repeated event_key is ignored.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await aiHandler(req, res, async () => {
    await aiActor(req, { allowApiKey: true });
    const events = (req.body as { events?: unknown })?.events;
    if (!Array.isArray(events) || events.length === 0) throw new AiUsageError("events_required");
    if (events.length > 200) throw new AiUsageError("too_many_events");
    let recorded = 0;
    for (const e of events) {
      if (e && typeof e === "object" && (await recordAiUsage(req.scope, e as Record<string, unknown>))) recorded += 1;
    }
    res.json({ received: events.length, recorded });
  });
}
