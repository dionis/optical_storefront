import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { parseBoardDate } from "../../../lib/board-dates";
import { normalizeSellerCodeLoose, scanBoardWindow } from "../../../lib/order-board";
import {
  countsForRevenue,
  currentMonthRange,
  customerInitials,
  findSellerById,
  isoAt,
  sellerLinks,
  verifySellerToken,
} from "../../../lib/sellers";

/**
 * GET /store/seller-dashboard?token=T&from&to — what a seller sees of their
 * own sales. Public route: the token in the link IS the credential (HMAC of
 * seller id + token_version; rotate-link in the admin invalidates it).
 *
 * Privacy: a seller is not staff. Every order row is reduced to number, date,
 * totals, stage and the customer's INITIALS — never email, phone, address,
 * items' prescription or anything that identifies the buyer. Period defaults
 * to the current month; `all_time` is computed over the board window.
 */
const MAX_ROWS = 200;
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = req.query as Record<string, string | undefined>;

  const payload = verifySellerToken(query.token);
  const seller = payload ? await findSellerById(req.scope, payload.sid) : null;
  if (!payload || !seller || !seller.active || seller.token_version !== payload.v) {
    res.status(401).json({ type: "unauthorized", reason: "bad_token", message: "Invalid or revoked seller link." });
    return;
  }

  const fromQ = parseBoardDate(query.from, "start");
  const toQ = parseBoardDate(query.to, "end");
  if (fromQ === false || toQ === false) {
    res.status(400).json({ type: "invalid_data", reason: "bad_date", message: "Dates must be ISO (YYYY-MM-DD)." });
    return;
  }
  const month = currentMonthRange();
  const from = fromQ ?? month.from;
  const to = toQ ?? month.to;

  try {
    // One scan without a date filter gives both the period and the all-time
    // figures (bounded by MAX_BOARD_SCAN, like every board report).
    const window = await scanBoardWindow(req.scope, {});
    const mine = window.orders.filter((o) => normalizeSellerCodeLoose(o.seller_code) === seller.code && countsForRevenue(o));
    const inPeriod = mine.filter((o) => {
      const at = isoAt(o.created_at);
      return at >= from && at <= to;
    });
    const pct = seller.commission_pct;
    const sum = (rows: typeof mine) => {
      const revenue = round2(rows.reduce((a, o) => a + (Number(o.total ?? 0) || 0), 0));
      return { orders: rows.length, revenue, commission: round2((revenue * pct) / 100) };
    };
    const currency = String(inPeriod[0]?.currency_code ?? mine[0]?.currency_code ?? "usd");

    res.json({
      seller: {
        name: seller.name,
        code: seller.code,
        commission_pct: pct,
        referral_url: sellerLinks(seller).referral_url,
        social: seller.social,
      },
      period: { from, to },
      totals: { ...sum(inPeriod), currency_code: currency },
      all_time: sum(mine),
      truncated: window.truncated,
      orders: inPeriod.slice(0, MAX_ROWS).map((o) => {
        const total = Number(o.total ?? 0) || 0;
        return {
          display_id: o.display_id,
          created_at: isoAt(o.created_at) || null,
          total,
          currency_code: o.currency_code,
          stage: o.stage,
          terminal: o.terminal,
          commission: round2((total * pct) / 100),
          customer: customerInitials(o.customer.name),
          items: o.items.reduce((n, it) => n + (Number(it.quantity) || 0), 0),
        };
      }),
    });
  } catch (error) {
    logger.error(`[seller-dashboard] ${seller.id}: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "dashboard_failed", message: "Could not load the dashboard." });
  }
}
