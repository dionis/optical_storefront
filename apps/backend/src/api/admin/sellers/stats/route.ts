import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { localParts } from "../../../../lib/alerts";
import { parseBoardDate } from "../../../../lib/board-dates";
import { netByUser } from "../../../../lib/sales-analytics";
import { insightAccess, orderEconomics } from "../../../../lib/sales-insights";
import { goalProgress, sellerStats, type SellerStatRow } from "../../../../lib/sellers";
import { profilesByUser } from "../../../../lib/staff-profile-data";
import { getStaffScope } from "../../../../lib/staff-scope";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/sellers/stats?from&to&store — sales and commission per seller over the
 * board window (`store` = establishment id or "web" narrows it to one store) (the `MAX_BOARD_SCAN` most recent orders in the range; the
 * response says `truncated` when the window was full). Terminal orders
 * (canceled / refunded / payment pending) earn nobody anything. Sellers with
 * no sales are listed with zeros; orders without a code go to `unattributed`.
 * Each row also carries `units`, `avg_ticket`, `share_pct` (the quota: their
 * part of every sale in the window) and, only for whoever may see costs
 * (lib/sales-insights.ts insightAccess, `access.profit`), `profit` and
 * `avg_profit`; otherwise those two are null. Biggest revenue first. Sellers
 * linked to a panel user also carry `goal` ({ amount, done, left, pct }, this
 * month's net against their monthly goal, HU-40) or null.
 */
/**
 * Each seller's progress towards their monthly goal (HU-40): the goal is in
 * the linked user's profile, `done` is this calendar month's NET (local days,
 * `sale_fact` total − tax, the commission base — what /sales-analytics/me
 * shows the seller). Two batched reads for every seller at once, whatever
 * the period on screen: a goal is monthly. Best-effort: a failure leaves
 * `goal: null`, the stats stand.
 */
async function attachGoals(container: MedusaContainer, rows: SellerStatRow[]): Promise<void> {
  const users = rows.map((r) => r.user_id).filter((id): id is string => Boolean(id));
  if (!users.length) return;
  try {
    const today = localParts(new Date(), tenant().timezone);
    const monthStart = `${today.date.slice(0, 8)}01`;
    const [profiles, net] = await Promise.all([profilesByUser(container, users), netByUser(container, { from: monthStart, to: today.date, stores: null }, users)]);
    for (const r of rows) {
      if (!r.user_id) continue;
      r.goal = goalProgress(profiles.get(r.user_id)?.monthly_goal ?? null, net.get(r.user_id) ?? 0);
    }
  } catch (e) {
    container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[sellers] goals not attached: ${(e as Error).message}`);
  }
}

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
    const stats = await sellerStats(req.scope, { from, to, store: query.store || null }, profitLoader);
    await attachGoals(req.scope, stats.sellers);
    res.json(stats);
  } catch (error) {
    logger.error(`[sellers] stats failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "stats_failed", message: "Could not compute seller stats." });
  }
}
