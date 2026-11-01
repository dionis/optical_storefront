import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { parseBoardDate } from "../../../../lib/board-dates";
import { insightAccess, orderEconomics } from "../../../../lib/sales-insights";
import { sellerStats } from "../../../../lib/sellers";
import { getStaffScope } from "../../../../lib/staff-scope";

/**
 * GET /admin/sellers/stats?from&to&store — sales and commission per seller over the
 * board window (`store` = establishment id or "web" narrows it to one store) (the `MAX_BOARD_SCAN` most recent orders in the range; the
 * response says `truncated` when the window was full). Terminal orders
 * (canceled / refunded / payment pending) earn nobody anything. Sellers with
 * no sales are listed with zeros; orders without a code go to `unattributed`.
 * Each row also carries `units`, `avg_ticket`, `share_pct` (the quota: their
 * part of every sale in the window) and, only for whoever may see costs
 * (lib/sales-insights.ts insightAccess, `access.profit`), `profit` and
 * `avg_profit`; otherwise those two are null. Biggest revenue first.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = req.query as Record<string, string | undefined>;
  const from = parseBoardDate(query.from, "start");
  const to = parseBoardDate(query.to, "end");
  if (from === false || to === false) {
    res.status(400).json({ type: "invalid_data", reason: "bad_date", message: "Dates must be ISO (YYYY-MM-DD)." });
    return;
  }
  try {
    const userId = req.auth_context?.actor_id;
    const access = userId ? insightAccess(await getStaffScope(req.scope, userId)) : { profit: false };
    const profitLoader = access.profit ? (filter: Parameters<typeof orderEconomics>[1], ids: string[]) => orderEconomics(req.scope, filter, ids) : null;
    res.json(await sellerStats(req.scope, { from, to, store: query.store || null }, profitLoader));
  } catch (error) {
    logger.error(`[sellers] stats failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "stats_failed", message: "Could not compute seller stats." });
  }
}
