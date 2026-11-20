import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { parseBoardDate } from "../../../lib/board-dates";
import { fetchBoardOrdersByIds } from "../../../lib/order-board";
import { referralSourcesByOrder, sellerFactOrders } from "../../../lib/sales-analytics";
import {
  attributeSale,
  currentMonthRange,
  customerInitials,
  dashboardFigures,
  findSellerById,
  listSellers,
  saleCommission,
  sellerLinks,
  sellerSourceOf,
  statsDayFilter,
  verifySellerToken,
  type DashboardOrder,
} from "../../../lib/sellers";

/**
 * GET /store/seller-dashboard?token=T&from&to — what a seller sees of their
 * own sales. Public route: the token in the link IS the credential (HMAC of
 * seller id + token_version; rotate-link in the admin invalidates it).
 *
 * Source: `sale_fact`, the same rows, local-day filter and attribution rule
 * (`attributeSale`: the till user first, then the referral code) as
 * `/admin/sellers/stats` — so the number a seller reads here is the number
 * the owner reads in Vendedores, to the cent (commission per line on the
 * net, `saleCommission`). Until 5-nov-2026 this read the order board's
 * window by referral code only, with the commission on the gross: a counter
 * seller saw $0, and a web seller saw a commission on the sales tax.
 *
 * Privacy: a seller is not staff. Every order row is reduced to number, date,
 * totals, stage and the customer's INITIALS — never email, phone, address,
 * items' prescription or anything that identifies the buyer. Period defaults
 * to the current month; `all_time` is every live sale of theirs.
 */
const MAX_ROWS = 200;

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
    // Every live sale ever (one bounded read, the Executive's own rows), then
    // the period is cut by LOCAL day in memory: both figures from one source.
    const all = statsDayFilter({ from: null, to: null });
    const period = statsDayFilter({ from, to });
    const [facts, sellers] = await Promise.all([sellerFactOrders(req.scope, all), listSellers(req.scope)]);
    // The same maps Vendedores attributes with: a till sale of a user who is
    // another record goes to that record, whatever code the receipt printed.
    const byUser = new Map(sellers.filter((s) => s.user_id).map((s) => [s.user_id as string, s.code]));
    const byCode = new Map(sellers.map((s) => [s.code, true]));
    const mine: DashboardOrder[] = facts.orders
      .filter((o) => attributeSale(o, byUser, byCode) === seller.code)
      .map((o) => ({
        id: o.order_id,
        seller_id: o.seller_id,
        seller_code: o.seller_code,
        channel: o.channel,
        total: o.total,
        tax_total: o.tax,
        shipping_total: 0,
        net_cents_lines: o.net_cents_lines,
        terminal: null,
        created_at: o.sold_at,
        units: o.units,
        sold_date_local: o.sold_date_local,
      }));
    const webIds = mine.filter((o) => o.channel === "web").map((o) => o.id);
    const sources = await referralSourcesByOrder(req.scope, webIds);
    for (const o of mine) o.seller_source = sources.get(o.id) ?? null;

    const pct = seller.commission_pct;
    const figures = dashboardFigures(mine, pct, { from: period.from, to: period.to });
    const page = figures.in_period.slice(0, MAX_ROWS);
    // Display number, stage and the customer's initials come from the order
    // itself, only for the rows shown.
    const board = new Map((await fetchBoardOrdersByIds(req.scope, page.map((o) => o.id))).map((b) => [b.id, b]));
    const currency = String(board.values().next().value?.currency_code ?? "usd");
    const links = sellerLinks(seller);

    res.json({
      seller: {
        name: seller.name,
        code: seller.code,
        commission_pct: pct,
        referral_url: links.referral_url,
        social_links: links.social_links,
        social: seller.social,
      },
      period: { from, to },
      totals: { ...figures.period, currency_code: currency, by_source: figures.by_source },
      all_time: figures.all_time,
      truncated: facts.truncated,
      orders: page.map((o) => {
        const b = board.get(o.id);
        return {
          display_id: b?.display_id ?? null,
          number: b?.pos_sale_number ?? null,
          created_at: o.created_at,
          total: Number(o.total ?? 0) || 0,
          currency_code: b?.currency_code ?? currency,
          stage: b?.stage ?? null,
          terminal: b?.terminal ?? null,
          commission: saleCommission(o, pct),
          customer: customerInitials(b?.customer.name),
          items: o.units ?? 0,
          source: sellerSourceOf(o),
        };
      }),
    });
  } catch (error) {
    logger.error(`[seller-dashboard] ${seller.id}: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "dashboard_failed", message: "Could not load the dashboard." });
  }
}
