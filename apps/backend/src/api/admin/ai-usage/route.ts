import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { RATES_READ_ON, isActivity, normalizeProvider } from "../../../lib/ai-usage";
import { aiUsageReport } from "../../../lib/ai-usage-data";
import { aiActor, aiHandler, parseRange } from "../../../lib/ai-usage-route";

/**
 * CONSUMO IA — GET /admin/ai-usage?from=&to=&provider=&activity=
 *
 * Balances (owner's entries minus measured cost), pace and days left per
 * provider, the owner's entries and alert rules, and the breakdown of the range
 * by activity, model and day plus the latest 500 calls. Owner and superadmin only.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await aiHandler(req, res, async () => {
    await aiActor(req);
    const q = req.query as Record<string, unknown>;
    const { from, to } = parseRange(q);
    const provider = normalizeProvider(q.provider);
    const activity = isActivity(q.activity) ? q.activity : null;
    const report = await aiUsageReport(req.scope, { from, to, provider, activity });
    res.json({ ...report, rates_read_on: RATES_READ_ON });
  });
}
