/**
 * WHERE EACH FIGURE OF THE MONTH'S RESULT COMES FROM (owner, 17-nov-2026: «en
 * cada card debe aparecer, cuando se dé clic, el desglose económico financiero
 * exacto de esos datos, de dónde sale eso»).
 *
 * The same ledger as the store result (lib/store-pnl.ts → loadLedger), opened
 * up: the parts of the net sales, of the cost of goods, of the payment fees
 * (by method), the commission of each seller, and each cost item with what it
 * charged this month and how (frequency, per sale × sales, share of a shared
 * one). The totals are recomputed with `computePnl` from these same parts, so
 * the breakdown always adds up to the cards to the cent.
 *
 * Dollars out (two decimals). Cost items keep their own fields so the screen
 * can say «$1,200 al mes» or «$50 a la semana × 52 ÷ 12».
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { bucketSum, loadLedger, sumFeesByStore, type EntityMonth } from "./financial-statement";
import { STORE_COST_MODULE } from "../modules/store-cost";
import { computePnl, monthlyCharge, type CostItemLike, type Pnl } from "./store-costs";
import { tenant } from "./tenant";

const d = (cents: number) => Math.round(cents) / 100;

export interface BreakdownItem {
  id: string;
  description: string | null;
  category: string | null;
  tax_category: string | null;
  bucket: "fixed" | "variable" | "shared";
  per_sale: boolean;
  /** Where it belongs: a store's code, or null = shared among stores. */
  owner_store: string | null;
  amount: number;
  frequency: string;
  amortize_months: number | null;
  allocation_method: "sales" | "percent" | null;
  /** The item's whole monthly charge (all stores) this month, before any split. */
  month_total: number;
  /** What it charged the stores in view this month. */
  charged: number;
  /** charged ÷ month_total (a shared item's part); null when the item is not shared. */
  share_pct: number | null;
  /** Sales of the month it was multiplied by (per-sale items). */
  sales_count: number | null;
}

export interface PnlBreakdown {
  month: string;
  store: { id: string; code: string; name: string } | null;
  stores: Array<{ id: string; code: string; name: string; net_sales: number; sales_count: number; result: number }>;
  sales: {
    gross: number;
    sales_tax: number;
    net: number;
    pos_net: number;
    web_net: number;
    taxable_net: number;
    exempt_net: number;
    shipping_income: number;
    count: number;
    avg_ticket: number | null;
  };
  cogs: { frames: number; lenses: number; treatments: number; per_order: number; total: number };
  fees: { total: number; by_method: Array<{ method_code: string; amount: number; count: number }>; web: number };
  commissions: { total: number; sellers: Array<{ seller_code: string | null; net_sales: number; pct: number | null; commission: number }> };
  items: BreakdownItem[];
  totals: Pnl;
  /** Days of the month and how many are left (store calendar), for «per day to break even». */
  calendar: { days: number; left: number; is_current: boolean };
}

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/** Adds an entity's figures into the running total (cents). Pure. */
export function addEntity(acc: EntityMonth | null, e: EntityMonth): EntityMonth {
  if (!acc) return { ...e, cogs: { ...e.cogs }, costs: [...e.costs] };
  return {
    ...acc,
    net_sales: acc.net_sales + e.net_sales,
    web_net_sales: (acc.web_net_sales ?? (acc.channel === "web" ? acc.net_sales : 0)) + (e.web_net_sales ?? (e.channel === "web" ? e.net_sales : 0)),
    taxable_net_sales: (acc.taxable_net_sales ?? 0) + (e.taxable_net_sales ?? 0),
    shipping_income: (acc.shipping_income ?? 0) + (e.shipping_income ?? 0),
    sales_tax: acc.sales_tax + e.sales_tax,
    gross_sales: acc.gross_sales + e.gross_sales,
    sales_count: acc.sales_count + e.sales_count,
    cogs: {
      frames: acc.cogs.frames + e.cogs.frames,
      lenses: acc.cogs.lenses + e.cogs.lenses,
      treatments: acc.cogs.treatments + e.cogs.treatments,
      per_order: acc.cogs.per_order + e.cogs.per_order,
      total: acc.cogs.total + e.cogs.total,
    },
    payment_fees: acc.payment_fees + e.payment_fees,
    commissions: acc.commissions + e.commissions,
    costs: [...acc.costs, ...e.costs],
  };
}

function daysOf(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export async function pnlBreakdown(container: MedusaContainer, month: string, storeIds: string[] | null, storeId: string | null): Promise<PnlBreakdown> {
  const view = storeId ? [storeId] : storeIds;
  const { ledger, shownStores } = await loadLedger(container, [month], view);
  const lm = ledger[0];
  const tz = tenant().timezone;

  let all: EntityMonth | null = null;
  const perStore: PnlBreakdown["stores"] = [];
  for (const s of shownStores) {
    const e = lm.entities.get(s.id);
    if (!e) continue;
    all = addEntity(all, e);
    const p = computePnl({ net_sales: e.net_sales, shipping_income: e.shipping_income ?? 0, cogs: e.cogs.total, payment_fees: e.payment_fees, commissions: e.commissions, variable_manual: bucketSum(e, "variable"), fixed: bucketSum(e, "fixed"), shared: bucketSum(e, "shared") });
    perStore.push({ id: s.id, code: s.code, name: s.name, net_sales: d(e.net_sales), sales_count: e.sales_count, result: d(p.result) });
  }
  const e: EntityMonth = all ?? { entity: "none", channel: "pos", net_sales: 0, sales_tax: 0, gross_sales: 0, sales_count: 0, cogs: { frames: 0, lenses: 0, treatments: 0, per_order: 0, total: 0 }, payment_fees: 0, commissions: 0, costs: [] };

  // Payment fees by method: the till's rows of the month (same rule as the ledger,
  // sumFeesByStore). What the ledger has beyond them is the web gateway's fee.
  const ids = shownStores.map((s) => s.id);
  const first = `${month}-01`;
  const winFrom = new Date(Date.parse(`${first}T00:00:00Z`) - 2 * 86400_000);
  const winTo = new Date(Date.parse(`${month}-${String(daysOf(month)).padStart(2, "0")}T00:00:00Z`) + 3 * 86400_000);
  const pays = ids.length
    ? ((await pgOf(container)("pos_sale_payment as p")
        .leftJoin("pos_sale as s", "s.id", "p.sale_id")
        .whereNull("p.deleted_at")
        .whereIn("p.establishment_id", ids)
        .whereBetween("p.created_at", [winFrom, winTo])
        .select("p.establishment_id", "p.fee_cents", "p.created_at", "p.method_code", "s.status as sale_status")) as Array<Record<string, unknown>>)
    : [];
  const byMethod = new Map<string, Array<Record<string, unknown>>>();
  for (const p of pays) {
    const k = String(p.method_code ?? "other");
    (byMethod.get(k) ?? byMethod.set(k, []).get(k)!).push(p);
  }
  const methods: PnlBreakdown["fees"]["by_method"] = [];
  let tillFees = 0;
  for (const [method_code, rows] of byMethod) {
    const cents = [...sumFeesByStore(rows as never, month, tz).values()].reduce((a, b) => a + b, 0);
    const count = rows.filter((r) => r.sale_status !== "voided" && Number(r.fee_cents) > 0).length;
    if (!cents) continue;
    tillFees += cents;
    methods.push({ method_code, amount: d(cents), count });
  }
  methods.sort((a, b) => b.amount - a.amount);

  // Cost items with what they charged in view, and the whole of each item this month.
  const svc = container.resolve(STORE_COST_MODULE) as { listCostItems: (f: unknown, o: unknown) => Promise<Array<Record<string, unknown>>> };
  const rows = await svc.listCostItems({}, { take: 5000 });
  const itemById = new Map(rows.map((r) => [String(r.id), r]));
  const charged = new Map<string, { cents: number; bucket: BreakdownItem["bucket"]; per_sale: boolean }>();
  for (const c of e.costs) {
    if (!c.cents) continue;
    const cur = charged.get(c.item_id);
    if (cur) cur.cents += c.cents;
    else charged.set(c.item_id, { cents: c.cents, bucket: c.bucket, per_sale: c.per_sale });
  }
  const codeOf = new Map(shownStores.map((s) => [s.id, s.code]));
  const items: BreakdownItem[] = [];
  for (const [id, c] of charged) {
    const r = itemById.get(id);
    const like = r ? ({ ...r, amount_cents: Number(r.amount_cents) } as unknown as CostItemLike) : null;
    const owner = (r?.establishment_id as string | null) ?? null;
    const perSaleCount = c.per_sale ? (owner ? lm.entities.get(owner)?.sales_count ?? null : e.sales_count) : null;
    // A shared item's whole month: its charge before the split (per-sale shared: × the chain's sales).
    const monthTotal = like ? (c.per_sale ? Math.round(like.amount_cents) * (perSaleCount ?? 0) : monthlyCharge(like, month)) : c.cents;
    items.push({
      id,
      description: (r?.description as string | null) ?? null,
      category: (r?.category as string | null) ?? null,
      tax_category: (r?.tax_category as string | null) ?? null,
      bucket: c.bucket,
      per_sale: c.per_sale,
      owner_store: owner ? codeOf.get(owner) ?? null : null,
      amount: like ? d(like.amount_cents) : d(c.cents),
      frequency: String(r?.frequency ?? "monthly"),
      amortize_months: r?.amortize_months == null ? null : Number(r.amortize_months),
      allocation_method: owner ? null : ((r?.allocation as { method?: string } | null)?.method === "percent" ? "percent" : "sales"),
      month_total: d(monthTotal || c.cents),
      charged: d(c.cents),
      share_pct: !owner && monthTotal > 0 ? Math.round((c.cents / monthTotal) * 1000) / 10 : null,
      sales_count: perSaleCount,
    });
  }
  const order = { fixed: 0, variable: 1, shared: 2 } as const;
  items.sort((a, b) => order[a.bucket] - order[b.bucket] || b.charged - a.charged);

  const totals = computePnl({
    net_sales: e.net_sales,
    shipping_income: e.shipping_income ?? 0,
    cogs: e.cogs.total,
    payment_fees: e.payment_fees,
    commissions: e.commissions,
    variable_manual: bucketSum(e, "variable"),
    fixed: bucketSum(e, "fixed"),
    shared: bucketSum(e, "shared"),
  });
  const web = e.web_net_sales ?? (e.channel === "web" ? e.net_sales : 0);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const isCurrent = today.startsWith(month);
  const days = daysOf(month);
  const store = storeId ? shownStores.find((s) => s.id === storeId) ?? null : null;

  return {
    month,
    store: store ? { id: store.id, code: store.code, name: store.name } : null,
    stores: perStore,
    sales: {
      gross: d(e.gross_sales),
      sales_tax: d(e.sales_tax),
      net: d(e.net_sales),
      pos_net: d(e.net_sales - web),
      web_net: d(web),
      taxable_net: d(e.taxable_net_sales ?? 0),
      exempt_net: d(e.net_sales - (e.taxable_net_sales ?? 0)),
      shipping_income: d(e.shipping_income ?? 0),
      count: e.sales_count,
      avg_ticket: e.sales_count ? d(Math.round(e.net_sales / e.sales_count)) : null,
    },
    cogs: { frames: d(e.cogs.frames), lenses: d(e.cogs.lenses), treatments: d(e.cogs.treatments), per_order: d(e.cogs.per_order), total: d(e.cogs.total) },
    fees: { total: d(e.payment_fees), by_method: methods, web: d(Math.max(0, e.payment_fees - tillFees)) },
    // `lm.sellers` is already in dollars (commissionsOf divides once): never d() again.
    commissions: { total: d(e.commissions), sellers: lm.sellers.map((s) => ({ seller_code: s.seller_code, net_sales: s.net_sales, pct: s.pct, commission: s.commission })).filter((s) => s.commission || s.net_sales) },
    items,
    totals: {
      ...totals,
      net_sales: d(totals.net_sales),
      shipping_income: d(totals.shipping_income),
      cogs: d(totals.cogs),
      payment_fees: d(totals.payment_fees),
      commissions: d(totals.commissions),
      variable_manual: d(totals.variable_manual),
      fixed: d(totals.fixed),
      shared: d(totals.shared),
      variable_total: d(totals.variable_total),
      contribution: d(totals.contribution),
      fixed_total: d(totals.fixed_total),
      result: d(totals.result),
      break_even: totals.break_even === null ? null : d(totals.break_even),
    },
    calendar: { days, left: isCurrent ? days - Number(today.slice(8, 10)) + 1 : 0, is_current: isCurrent },
  };
}
