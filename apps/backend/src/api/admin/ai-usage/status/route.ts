import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { providerOverview } from "../../../../lib/ai-usage-data";
import { aiActor, aiHandler } from "../../../../lib/ai-usage-route";

/**
 * GET /admin/ai-usage/status — the light read behind the panel's badge and
 * banner: each provider's state and balance, without the report.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await aiHandler(req, res, async () => {
    await aiActor(req);
    const { providers } = await providerOverview(req.scope);
    const attention = providers.filter((p) => p.state === "low" || p.state === "empty" || p.state === "no_credit");
    res.json({
      attention: attention.length,
      providers: providers.map((p) => ({ provider: p.provider, state: p.state, remaining: p.remaining, days_left: p.days_left })),
    });
  });
}
