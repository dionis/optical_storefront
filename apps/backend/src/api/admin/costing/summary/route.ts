import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { parseBoardDate } from "../../../../lib/board-dates";
import {
  computeCostSheet,
  condenseLines,
  loadCostingContext,
  orderBrands,
  readStoredSheet,
  summarizeCostSheets,
  undefinedCostCount,
  type SummaryEntry,
} from "../../../../lib/costing";
import { scanBoardWindow } from "../../../../lib/order-board";
import { tenant } from "../../../../lib/tenant";

/**
 * GET /admin/costing/summary?from&to&seller — gross, deductions, net base,
 * cost and profit per order and in total over the board window, plus where
 * the money went:
 *
 *   - `totals`    the window as one sheet: `gross` (= `revenue`),
 *                 `deductions`, `net_base`, `materials`, `percent_items`,
 *                 `commission`, `cost`, `profit` (= `margin`), `margin_pct`,
 *                 `profit_pct_net`, and the owner's target against the real
 *                 profit of the period (`profit_target_*`, `profit_gap`).
 *   - `by_kind`   one row per concept (`${kind}:${match_key}`: "Montura
 *                 Flexure", "Alquiler 10 %", the order's taxes, the seller
 *                 commission…), biggest first — the owner's "how much goes
 *                 where".
 *   - `by_seller` / `by_day` / `by_brand` for the panel's charts.
 *
 * Terminal orders (canceled, refunded, payment pending) are left out of the
 * list and the totals: they cost nothing and earned nothing worth reporting.
 * `seller` filters by code ("none" = unattributed).
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
  const sellerRaw = String(query.seller ?? "").trim();
  const seller = sellerRaw.toLowerCase() === "none" ? "none" : sellerRaw.toUpperCase();

  try {
    // Same window as the board; the raw rows are kept because the stored
    // override lives in metadata, which the projection does not carry.
    const window = await scanBoardWindow(req.scope, { from: from ?? undefined, to: to ?? undefined });
    const { rules, sellerByCode } = await loadCostingContext(req.scope);

    const orders: Array<Record<string, unknown>> = [];
    const entries: SummaryEntry[] = [];

    for (const [i, o] of window.orders.entries()) {
      if (o.terminal) continue;
      if (seller === "none" && o.seller_code) continue;
      if (seller && seller !== "none" && o.seller_code !== seller) continue;
      const stored = readStoredSheet(window.raw[i]?.["metadata"] as Record<string, unknown> | null);
      const sellerRow = o.seller_code ? sellerByCode.get(o.seller_code) ?? null : null;
      const sheet = computeCostSheet(
        { total: o.total, shipping_total: o.shipping_total, tax_total: o.tax_total, paid: o.paid, items: o.items },
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
        gross: sheet.gross,
        deductions_total: sheet.deductions_total,
        net_base: sheet.net_base,
        cost_total: sheet.cost_total,
        margin: sheet.margin,
        margin_pct: sheet.margin_pct,
        profit_pct_net: sheet.profit_pct_net,
        profit_target_amount: sheet.profit_target_amount,
        profit_gap: sheet.profit_gap,
        suggested_price: sheet.suggested_price,
        suggested_delta: sheet.suggested_delta,
        manual: sheet.manual,
        undefined_costs: undefinedCostCount(sheet),
        breakdown: condenseLines(sheet.lines),
      });
      entries.push({ order: { ...o, customer_name: o.customer.name }, sheet });
    }

    const groups = summarizeCostSheets(entries, sellerByCode, tenant().timezone);

    res.json({
      from,
      to,
      orders,
      ...groups,
      truncated: window.truncated,
      rules_defined: rules.length > 0,
    });
  } catch (error) {
    logger.error(`[costing] summary failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "summary_failed", message: "Could not compute the cost summary." });
  }
}
