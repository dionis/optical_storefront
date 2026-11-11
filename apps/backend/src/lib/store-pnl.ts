import type { MedusaContainer } from "@medusajs/framework/types";
import { bucketSum, loadLedger } from "./financial-statement";
import { frameCostsLoaded } from "./frame-cost";
import { lensCellCostsKnown } from "./lens-cost";
import { costSourcesMissing } from "./sales-insights";
import { computePnl, type Pnl } from "./store-costs";

/**
 * The monthly result of each store (HU-96) and what goes with it: seller
 * commissions (HU-34) and the settlement with family, partner or consignment
 * stores (HU-33). Till sales only; the web has its own cost sheets in Costs.
 *
 *  net sales      sale_fact totals minus sales tax
 *  cost of goods  the owner's cost rules (Costs tab: frame by brand, lens
 *                 design/material/treatments), "material" lines only
 *  payment fees   the fee recorded with each payment at the time
 *  commissions    each seller's net sales × their commission % (profile,
 *                 seller record, then the default — lib/commission-pct.ts)
 *  costs          the store's fixed and variable items of the month, plus
 *                 its share of the shared ones, plus the per-sale items ×
 *                 its sales (always variable); inactive items out
 *
 * Since 7-nov-2026 the arithmetic lives in lib/financial-statement.ts
 * (`ledgerOf`), which the financial statement reads too: the store result and
 * the statement's column of the store are one computation. This file keeps
 * its API (`monthPnl`, and the pure helpers re-exported below).
 */

export { commissionsOf, sumFeesByStore, type CommissionFactLike, type FeeRowLike, type SellerCommission } from "./financial-statement";

export interface StorePnl extends Pnl {
  establishment_id: string;
  code: string;
  name: string;
  kind: string;
  sales_count: number;
  settlement: { pct: number; store_share: number; owner_share: number } | null;
}

export interface MonthPnl {
  month: string;
  stores: StorePnl[];
  total: Pnl;
  sellers: Array<{ seller_id: string | null; seller_code: string | null; net_sales: number; pct: number | null; commission: number }>;
  cost_rules_missing: boolean;
}

export async function monthPnl(container: MedusaContainer, month: string, storeIds: string[] | null): Promise<MonthPnl> {
  const { ledger, shownStores, rules } = await loadLedger(container, [month], storeIds);
  const lm = ledger[0];
  const c = (v: number) => v / 100;
  const stores: StorePnl[] = shownStores.map((s) => {
    const e = lm.entities.get(s.id);
    const net = e?.net_sales ?? 0;
    const p = computePnl({
      net_sales: net,
      cogs: e?.cogs.total ?? 0,
      payment_fees: e?.payment_fees ?? 0,
      commissions: e?.commissions ?? 0,
      variable_manual: e ? bucketSum(e, "variable") : 0,
      fixed: e ? bucketSum(e, "fixed") : 0,
      shared: e ? bucketSum(e, "shared") : 0,
    });
    const pct = (s as { settlement_pct?: number | null }).settlement_pct ?? null;
    return {
      ...toDollars(p),
      establishment_id: s.id,
      code: s.code,
      name: s.name,
      kind: s.kind,
      sales_count: e?.sales_count ?? 0,
      settlement: s.kind !== "own" && s.kind !== "online" && pct !== null ? { pct, store_share: c(Math.round((net * pct) / 100)), owner_share: c(net - Math.round((net * pct) / 100)) } : null,
    };
  });
  const sum = (k: keyof Pnl) => stores.reduce((acc, x) => acc + Math.round(Number(x[k]) * 100), 0);
  const total = toDollars(
    computePnl({
      net_sales: sum("net_sales"),
      cogs: sum("cogs"),
      payment_fees: sum("payment_fees"),
      commissions: sum("commissions"),
      variable_manual: sum("variable_manual"),
      fixed: sum("fixed"),
      shared: sum("shared"),
    })
  );
  // "No cost of goods defined yet": the same predicate as the Executive
  // (lib/sales-insights.ts costSourcesMissing) — no material rule with an
  // amount AND no supplier list AND no lens cell cost. `listCostRules` (inside
  // the ledger) warmed both caches, so the two screens answer the same banner.
  return { month, stores, total, sellers: lm.sellers, cost_rules_missing: costSourcesMissing(rules, frameCostsLoaded(), lensCellCostsKnown()) };
}

function toDollars(p: Pnl): Pnl {
  const d = (v: number | null) => (v === null ? null : v / 100);
  return {
    net_sales: p.net_sales / 100,
    cogs: p.cogs / 100,
    payment_fees: p.payment_fees / 100,
    commissions: p.commissions / 100,
    variable_manual: p.variable_manual / 100,
    fixed: p.fixed / 100,
    shared: p.shared / 100,
    variable_total: p.variable_total / 100,
    contribution: p.contribution / 100,
    contribution_pct: p.contribution_pct,
    fixed_total: p.fixed_total / 100,
    result: p.result / 100,
    break_even: d(p.break_even),
  };
}
