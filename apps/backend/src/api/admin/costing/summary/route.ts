import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { parseBoardDate } from "../../../../lib/board-dates";
import {
  computeCostSheet,
  condenseLines,
  loadCostingContext,
  orderBrands,
  profitTargetFor,
  profitTargetPct,
  readStoredSheet,
  summarizeCostSheets,
  undefinedCostCount,
  type SummaryEntry,
} from "../../../../lib/costing";
import { scanBoardWindow } from "../../../../lib/order-board";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/costing/summary?from&to&seller — revenue, cost and margin per
 * order and in total over the board window, plus where the money went:
 *
 *   - `by_kind`   one row per concept (`${kind}:${match_key}`: "Montura
 *                 Flexure", "Alquiler 10 %", the seller commission…), biggest
 *                 first — the owner's "how much goes where".
 *   - `by_seller` / `by_day` / `by_brand` for the panel's charts.
 *   - `totals.profit_target_*` the owner's target profit against the real
 *                 margin of the period.
 *
 * Terminal orders (canceled, refunded, payment pending) are left out of the
 * list and the totals: they cost nothing and earned nothing worth reporting.
 * `seller` filters by code ("none" = unattributed).
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = req.query as Record<string, string | undefined>;
  const from = parseBoardDate(query.from, "start");
  const to = parseBoardDate(query.to, "end");
  if (from === false || to === false) {
    res.status(400).json({ type: "invalid_data", reason: "bad_date", message: "Dates must be ISO (YYYY-MM-DD)." });
    return;
  }
  const sellerRaw = String(query.seller ?? "").trim();
  const seller = sellerRaw.toLowerCase() === "none" ? "none" : sellerRaw.toUpperCase();

  try {
    // Same window as the board; the raw rows are kept because the stored
    // override lives in metadata, which the projection does not carry.
    const window = await scanBoardWindow(req.scope, { from: from ?? undefined, to: to ?? undefined });
    const { rules, sellerByCode } = await loadCostingContext(req.scope);

    const orders: Array<Record<string, unknown>> = [];
    const entries: SummaryEntry[] = [];
    const totals = { orders: 0, revenue: 0, cost: 0, margin: 0, margin_pct: 0 };

    for (const [i, o] of window.orders.entries()) {
      if (o.terminal) continue;
      if (seller === "none" && o.seller_code) continue;
      if (seller && seller !== "none" && o.seller_code !== seller) continue;
      const stored = readStoredSheet(window.raw[i]?.["metadata"] as Record<string, unknown> | null);
      const sellerRow = o.seller_code ? sellerByCode.get(o.seller_code) ?? null : null;
      const sheet = computeCostSheet(
        { total: o.total, shipping_total: o.shipping_total, paid: o.paid, items: o.items },
        rules,
        sellerRow,
        stored
      );
      orders.push({
        id: o.id,
        display_id: o.display_id,
        created_at: o.created_at,
        customer_name: o.customer.name,
        seller_code: o.seller_code,
        seller_source: o.seller_source,
        items_count: o.items.reduce((n, it) => n + (Number(it.quantity) || 0), 0),
        brands: orderBrands(o.items),
        revenue: sheet.revenue,
        cost_total: sheet.cost_total,
        margin: sheet.margin,
        margin_pct: sheet.margin_pct,
        manual: sheet.manual,
        undefined_costs: undefinedCostCount(sheet),
        breakdown: condenseLines(sheet.lines),
      });
      entries.push({ order: { ...o, customer_name: o.customer.name }, sheet });
      totals.orders++;
      totals.revenue = round2(totals.revenue + sheet.revenue);
      totals.cost = round2(totals.cost + sheet.cost_total);
    }
    totals.margin = round2(totals.revenue - totals.cost);
    totals.margin_pct = totals.revenue > 0 ? round2((totals.margin / totals.revenue) * 100) : 0;

    const groups = summarizeCostSheets(entries, sellerByCode, tenant().timezone);

    res.json({
      from,
      to,
      orders,
      totals: { ...totals, ...profitTargetFor(profitTargetPct(rules), totals.revenue, totals.margin) },
      ...groups,
      truncated: window.truncated,
      rules_defined: rules.length > 0,
    });
  } catch (error) {
    logger.error(`[costing] summary failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "summary_failed", message: "Could not compute the cost summary." });
  }
}
