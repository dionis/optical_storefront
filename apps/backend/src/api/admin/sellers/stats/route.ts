import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { sellerStats } from "../../../../lib/sellers";
import { parseBoardDate } from "../../../../lib/board-dates";

/**
 * GET /admin/sellers/stats?from&to — sales and commission per seller over the
 * board window (the `MAX_BOARD_SCAN` most recent orders in the range; the
 * response says `truncated` when the window was full). Terminal orders
 * (canceled / refunded / payment pending) earn nobody anything. Sellers with
 * no sales are listed with zeros; orders without a code go to `unattributed`.
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
    res.json(await sellerStats(req.scope, { from, to }));
  } catch (error) {
    logger.error(`[sellers] stats failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "stats_failed", message: "Could not compute seller stats." });
  }
}
