import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { STORE_COST_MODULE } from "../modules/store-cost";
import type StoreCostModuleService from "../modules/store-cost/service";
import { localParts } from "./alerts";
import { commissionResolverOf } from "./commission-pct";
import { computeCostSheet, isPaymentFeeRule, lineGroup, lineKind, listCostRules, type CostOrderLike, type CostRule } from "./costing";
import { listEstablishments, type EstablishmentRow } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { parseLensFinish } from "./lens-finish";
import { listSellers } from "./sellers";
import { profilesByUser } from "./staff-profile-data";
import { loadDefaultCommissionPct } from "./store-cost-toggle";
import { allocateShared, monthlyCharge, perSaleCharge, taxCategoryOf, TAX_CATEGORIES, type CostItemLike, type TaxCategory } from "./store-costs";
import { tenant } from "./tenant";

/**
 * THE LEDGER every money screen of a month reads, and the FINANCIAL STATEMENT
 * (estado de resultados) built on it.
 *
 *  - `ledgerOf` (pure) turns one or more months of sold lines, payments, cost
 *    rules and cost items into cents per month and per ENTITY: each store
 *    (till sales, `channel = 'pos'`) and «web» (online orders). lib/store-pnl.ts
 *    builds the store result from THIS function (it used to hold the same code),
 *    so the result of a store and its column in the statement are the same
 *    numbers by construction, not by coincidence.
 *  - `statementOf` (pure) arranges a ledger as a US small-business income
 *    statement: revenue by channel, cost of goods, gross profit, operating
 *    expenses by IRS category (Schedule C Part II / Form 1120-S lines), card
 *    processing fees, seller commissions, operating and net income, with sales
 *    tax collected shown apart as a LIABILITY (never revenue).
 *  - `loadLedger` is the one loader (I/O).
 *
 * Every figure is integer cents until the route divides once.
 *
 * Conventions (docs/CONTABILIDAD.md §5 and §8):
 *  - periods are WHOLE local calendar months; a statement of a quarter or a
 *    year is the sum of its months (the validity of a cost is read by month);
 *  - cost of goods = the owner's cost rules, "material" lines only (frame,
 *    lens, treatments and the per-order fixed costs: lab, packaging), the same
 *    as Ejecutivo; plus the cost items the owner filed as cost_of_goods
 *    (remakes, lab bills) — those are in the store result's fixed/variable
 *    lines, here in COGS, and net income is the same either way;
 *  - payment fees: till sales = the fee recorded with each payment in the
 *    local month, voided sales out (`sumFeesByStore`); web = the gateway's %
 *    of what the customer paid + its fixed fee per order (Ejecutivo's rule);
 *  - commissions: per line, % of the line's NET (`commissionsOf`), with the
 *    precedence of lib/commission-pct.ts (profile, seller record, default);
 *  - store costs: fixed/variable items of the store, its share of the shared
 *    ones (`allocateShared`, weights from EVERY active store) and the per-sale
 *    items × the store's sales. Inactive items are out. The web carries no
 *    store costs (they are the shops' rent and payroll).
 *  - `order_percent` distribution rules (renta 5 %, marketing 3 %…) are budget
 *    shares of the cost sheet, not incurred costs: the real rent is a cost
 *    item. They are in neither the result nor the statement.
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/** The pseudo entity of online orders. */
export const WEB_ENTITY = "web";

// ── Payment fees and commissions (pure; re-exported by store-pnl.ts) ─────────

/** A recorded payment as the fee total reads it. */
export interface FeeRowLike {
  establishment_id: string | null;
  fee_cents: number | string | null;
  created_at: string | Date;
  /** Status of the sale the payment belongs to: a voided sale's fee is not a cost of the month. */
  sale_status?: string | null;
}

/**
 * Payment fees of a month, by store, in cents. Pure.
 *
 * Two rules, and both matter:
 *  - the month is the LOCAL calendar month of the payment (the SQL window is
 *    wider on purpose, so a payment at 23:00 of the last day is not lost);
 *  - a VOIDED sale's fees are left out. Its sales are already out (sale_fact
 *    keeps the rows marked `voided` and every report filters them), so
 *    charging the fee would book a cost against revenue that was reversed —
 *    lib/sales-insights.ts leaves them out too, and the two screens have to
 *    answer the same number.
 */
export function sumFeesByStore(pays: readonly FeeRowLike[], month: string, tz: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pays) {
    if (p.sale_status === "voided") continue;
    if (!localParts(new Date(p.created_at as string), tz).date.startsWith(month)) continue;
    const store = String(p.establishment_id ?? "");
    if (!store) continue;
    out.set(store, (out.get(store) ?? 0) + Math.round(Number(p.fee_cents ?? 0) || 0));
  }
  return out;
}

/** A sold line as the commission split reads it (cents). */
export interface CommissionFactLike {
  establishment_id: string | null;
  seller_id: string | null;
  seller_code: string | null;
  net: number;
}

export interface SellerCommission {
  seller_id: string | null;
  seller_code: string | null;
  net_sales: number;
  pct: number | null;
  commission: number;
}

/**
 * Seller commissions from the net of each line. Pure.
 *
 * `pctOf` is the SAME precedence lib/sales-insights.ts uses
 * (lib/commission-pct.ts: profile, seller record, default), so a referral-only
 * seller with no panel user still earns in the store result, instead of
 * earning in Ejecutivo and nowhere else. Amounts in cents; the base is the NET
 * (total − sales tax), never the gross; rounded per line.
 */
export function commissionsOf(
  facts: readonly CommissionFactLike[],
  pctOf: (f: CommissionFactLike) => number | null
): { sellers: SellerCommission[]; byStore: Map<string, number> } {
  type Group = { seller_id: string | null; seller_code: string | null; net: number; commission: number };
  const groups = new Map<string, Group>();
  const byStore = new Map<string, number>();
  for (const f of facts) {
    // A seller is the panel user who sold; a web referral has only a code.
    const key = f.seller_id ?? (f.seller_code ? `code:${f.seller_code}` : "-");
    const group = groups.get(key) ?? { seller_id: f.seller_id ?? null, seller_code: f.seller_code ?? null, net: 0, commission: 0 };
    const pct = key === "-" ? null : pctOf(f);
    const commission = pct ? Math.round((f.net * pct) / 100) : 0;
    group.net += f.net;
    group.commission += commission;
    groups.set(key, group);
    if (commission) {
      const store = String(f.establishment_id ?? "");
      if (store) byStore.set(store, (byStore.get(store) ?? 0) + commission);
    }
  }
  const sellers = [...groups.entries()].map(([key, g]) => ({
    seller_id: g.seller_id,
    seller_code: g.seller_code,
    net_sales: g.net / 100,
    pct: key === "-" ? null : pctOf({ establishment_id: null, seller_id: g.seller_id, seller_code: g.seller_code, net: 0 }),
    commission: g.commission / 100,
  }));
  return { sellers, byStore };
}

// ── Periods ─────────────────────────────────────────────────────────────────

export const STATEMENT_GROUPS = ["month", "quarter", "year"] as const;
export type StatementGroup = (typeof STATEMENT_GROUPS)[number];
/** Longest statement, in months (each month is one pass of the ledger). */
export const MAX_STATEMENT_MONTHS = 36;

const mIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const ymOf = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

/** Every month YYYY-MM from the month of `from` to the month of `to`, inclusive. Pure. */
export function monthsBetween(from: string, to: string): string[] {
  const a = mIndex(from.slice(0, 7));
  const b = mIndex(to.slice(0, 7));
  const out: string[] = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(ymOf(i));
  return out;
}

/** The period a month belongs to: "2026-11", "2026-Q4" or "2026". Pure. */
export function periodKeyOf(month: string, group: StatementGroup): string {
  if (group === "year") return month.slice(0, 4);
  if (group === "quarter") return `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;
  return month.slice(0, 7);
}

/** Last day (YYYY-MM-DD) of a month. Pure. */
export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

// ── The ledger ───────────────────────────────────────────────────────────────

export interface CogsCents {
  frames: number;
  lenses: number;
  treatments: number;
  /** order_fixed rules: lab mounting, packaging… charged once per sale. */
  per_order: number;
  /** Σ of the four above: the material cost (Ejecutivo `cost`, store result `cogs`). */
  total: number;
}

export interface CostCharge {
  item_id: string;
  /** Where the store result puts it: fixed / variable («variables a mano») / shared. Per-sale items are always variable. */
  bucket: "fixed" | "variable" | "shared";
  tax_category: TaxCategory;
  per_sale: boolean;
  cents: number;
}

export interface EntityMonth {
  entity: string;
  channel: "pos" | "web";
  /** Σ (total − tax) of the active lines. */
  net_sales: number;
  /** Σ tax: collected for the state, a liability. */
  sales_tax: number;
  /** Σ total (what customers were charged, tax included). */
  gross_sales: number;
  /** Distinct sales (orders). */
  sales_count: number;
  cogs: CogsCents;
  payment_fees: number;
  commissions: number;
  costs: CostCharge[];
}

export interface LedgerMonth {
  month: string;
  entities: Map<string, EntityMonth>;
  sellers: SellerCommission[];
}

/** A sold line of sale_fact as the ledger reads it (cents). */
export interface LedgerFact {
  order_id: string;
  channel: string;
  establishment_id: string | null;
  seller_id: string | null;
  seller_code: string | null;
  product_id: string | null;
  sku: string | null;
  qty: number;
  total_cents: number;
  tax_cents: number;
  lens_design: string | null;
  lens_material: string | null;
  lens_photo: string | null;
  lens_ar: string | null;
  lens_finish: string | null;
  sold_date_local: string;
}

export interface LedgerItem extends CostItemLike {
  id: string;
}

export interface LedgerInput {
  months: string[];
  facts: readonly LedgerFact[];
  pays: readonly FeeRowLike[];
  rules: CostRule[];
  items: readonly LedgerItem[];
  /** brand slug (or collection slug) of each product id. */
  brandOf: (productId: string | null) => string | null;
  pctOf: (f: CommissionFactLike) => number | null;
  /** Stores in view (ids). */
  storeIds: string[];
  /** Every ACTIVE store: the weights of a shared cost split among them. */
  activeStoreIds: string[];
  /**
   * Net till sales by month and store of EVERY active store (the weights of a
   * cost shared "by sales"). Optional: when absent, the stores in view are
   * used — correct only when the view is the whole chain.
   */
  netByMonthStore?: Map<string, Map<string, number>>;
  tz: string;
  /** Include the online orders as the «web» entity. */
  web: boolean;
}

const emptyCogs = (): CogsCents => ({ frames: 0, lenses: 0, treatments: 0, per_order: 0, total: 0 });

/** Which COGS line a material line of a cost sheet is. */
function cogsLineOf(kind: string): keyof Omit<CogsCents, "total"> {
  if (kind === "frame_brand" || kind === "frame_sku") return "frames";
  if (kind === "lens_photo" || kind === "lens_ar") return "treatments";
  if (kind === "order_fixed") return "per_order";
  return "lenses";
}

/**
 * Cents per month and entity. Pure — the same arithmetic the store result had
 * inline before 7-nov-2026 (one cost sheet per sale, material lines only;
 * fees by local month without voided sales; commission per line; store
 * costs by validity, frequency, sharing and per sale), plus the web.
 */
export function ledgerOf(input: LedgerInput): LedgerMonth[] {
  const { months, rules } = input;
  const ids = new Set(input.storeIds);
  const active = rules.filter((r) => r.active);
  const gatewayPct = active.filter(isPaymentFeeRule).reduce((s, r) => s + r.amount, 0);
  const gatewayFixed = active.filter((r) => r.kind === "payment_fixed").reduce((s, r) => s + Math.round(r.amount * 100), 0);

  const out: LedgerMonth[] = [];
  for (const month of months) {
    const entities = new Map<string, EntityMonth>();
    const entityOf = (id: string, channel: "pos" | "web"): EntityMonth => {
      let e = entities.get(id);
      if (!e) {
        e = { entity: id, channel, net_sales: 0, sales_tax: 0, gross_sales: 0, sales_count: 0, cogs: emptyCogs(), payment_fees: 0, commissions: 0, costs: [] };
        entities.set(id, e);
      }
      return e;
    };
    for (const id of input.storeIds) entityOf(id, "pos");
    if (input.web) entityOf(WEB_ENTITY, "web");

    const lines = input.facts.filter((f) => f.sold_date_local.startsWith(month) && (f.channel === "web" ? input.web : ids.has(String(f.establishment_id ?? ""))));
    const keyOf = (f: LedgerFact) => (f.channel === "web" ? WEB_ENTITY : String(f.establishment_id));

    // Sales, tax and cost of goods: one sheet per sale.
    const byOrder = new Map<string, LedgerFact[]>();
    for (const f of lines) {
      const group = byOrder.get(f.order_id);
      if (group) group.push(f);
      else byOrder.set(f.order_id, [f]);
    }
    const commissionFacts: CommissionFactLike[] = [];
    for (const group of byOrder.values()) {
      const first = group[0];
      const ent = entityOf(keyOf(first), first.channel === "web" ? "web" : "pos");
      const order: CostOrderLike = {
        // The store that sold it: a frame's cost is that store's own when it
        // holds one, the chain's otherwise (lib/frame-cost.ts). A web order has none.
        establishment_id: first.channel === "web" ? null : String(first.establishment_id ?? "") || null,
        total: group.reduce((s, l) => s + l.total_cents, 0) / 100,
        tax_total: group.reduce((s, l) => s + l.tax_cents, 0) / 100,
        paid: true,
        items: group.map((l) => ({
          quantity: l.qty,
          sku: l.sku,
          brand_slug: input.brandOf(l.product_id),
          lens: l.lens_design ? { design_code: l.lens_design, material_code: l.lens_material, photo_code: l.lens_photo, ar_code: l.lens_ar, finish: parseLensFinish(l.lens_finish) } : null,
        })),
      };
      const sheet = computeCostSheet(order, rules, null, null, null);
      for (const l of sheet.lines) {
        if (lineGroup(l) !== "material") continue;
        const cents = Math.round(Number(l.subtotal) * 100);
        ent.cogs[cogsLineOf(lineKind(l))] += cents;
        ent.cogs.total += cents;
      }
      const gross = group.reduce((s, l) => s + l.total_cents, 0);
      ent.gross_sales += gross;
      ent.sales_tax += group.reduce((s, l) => s + l.tax_cents, 0);
      ent.net_sales += group.reduce((s, l) => s + (l.total_cents - l.tax_cents), 0);
      ent.sales_count += 1;
      // A web order's fee is the gateway's: % of what the customer paid + fixed.
      if (first.channel === "web") ent.payment_fees += Math.round((gross * gatewayPct) / 100) + gatewayFixed;
      for (const l of group) commissionFacts.push({ establishment_id: keyOf(l), seller_id: l.seller_id, seller_code: l.seller_code, net: l.total_cents - l.tax_cents });
    }

    // Till payment fees of the month (local day), voided sales out.
    for (const [store, fee] of sumFeesByStore(input.pays, month, input.tz)) {
      if (ids.has(store)) entityOf(store, "pos").payment_fees += fee;
    }

    const { sellers, byStore } = commissionsOf(commissionFacts, input.pctOf);
    for (const [store, c] of byStore) {
      const e = entities.get(store);
      if (e) e.commissions += c;
    }

    // Store costs.
    const ownNet = new Map<string, number>();
    for (const [id, e] of entities) if (e.channel === "pos") ownNet.set(id, e.net_sales);
    const weights = input.netByMonthStore?.get(month) ?? ownNet;
    for (const it of input.items) {
      const tax_category = taxCategoryOf(it);
      if (it.per_sale) {
        // «Se cobra en cada venta»: × each store's sales of the month. A shared
        // per-sale item is charged in every store, on that store's own sales.
        const targets = it.establishment_id ? [it.establishment_id] : input.storeIds;
        for (const store of targets) {
          const e = entities.get(store);
          if (!e || e.channel !== "pos") continue;
          const cents = perSaleCharge(it, month, e.sales_count);
          if (cents) e.costs.push({ item_id: it.id, bucket: "variable", tax_category, per_sale: true, cents });
        }
        continue;
      }
      const charge = monthlyCharge(it, month);
      if (!charge) continue;
      if (it.establishment_id) {
        const e = entities.get(it.establishment_id);
        if (!e || e.channel !== "pos") continue;
        e.costs.push({ item_id: it.id, bucket: it.kind === "fixed" ? "fixed" : "variable", tax_category, per_sale: false, cents: charge });
      } else {
        // Shared among EVERY active store (not only those in view), so a filtered view shows the same share.
        for (const [store, part] of allocateShared(charge, it.allocation, input.activeStoreIds, weights)) {
          const e = entities.get(store);
          if (e && e.channel === "pos" && part) e.costs.push({ item_id: it.id, bucket: "shared", tax_category, per_sale: false, cents: part });
        }
      }
    }
    out.push({ month, entities, sellers });
  }
  return out;
}

/** Σ of a cost bucket of an entity month. */
export function bucketSum(e: Pick<EntityMonth, "costs">, bucket: CostCharge["bucket"]): number {
  return e.costs.reduce((s, c) => s + (c.bucket === bucket ? c.cents : 0), 0);
}

// ── The statement ────────────────────────────────────────────────────────────

/** Operating-expense lines, in the order of Schedule C Part II. cost_of_goods is in COGS. */
export const OPEX_CATEGORIES = TAX_CATEGORIES.filter((c) => c !== "cost_of_goods") as Exclude<TaxCategory, "cost_of_goods">[];

/**
 * Line of IRS Schedule C (Form 1040) and of Form 1120-S for each statement
 * line, for the accountant. Guidance, not tax advice: e.g. commissions paid
 * to EMPLOYEES are wages (Schedule C 26 / 1120-S 8), to contractors line 10.
 */
export const TAX_LINES: Record<string, { schedule_c: string; f1120s: string }> = {
  revenue: { schedule_c: "1", f1120s: "1a" },
  cogs: { schedule_c: "4 (Part III)", f1120s: "2 (Form 1125-A)" },
  cost_of_goods: { schedule_c: "4 (Part III, 39)", f1120s: "2 (Form 1125-A)" },
  gross_profit: { schedule_c: "5", f1120s: "3" },
  advertising: { schedule_c: "8", f1120s: "16" },
  commissions: { schedule_c: "10", f1120s: "19" },
  card_fees: { schedule_c: "27a (Part V)", f1120s: "19" },
  bank_fees: { schedule_c: "27a (Part V)", f1120s: "19" },
  depreciation: { schedule_c: "13 (Form 4562)", f1120s: "14 (Form 4562)" },
  insurance: { schedule_c: "15", f1120s: "19" },
  professional_fees: { schedule_c: "17", f1120s: "19" },
  software: { schedule_c: "18", f1120s: "19" },
  rent: { schedule_c: "20b", f1120s: "11" },
  repairs: { schedule_c: "21", f1120s: "9" },
  supplies: { schedule_c: "22", f1120s: "19" },
  taxes_licenses: { schedule_c: "23", f1120s: "12" },
  payroll_taxes: { schedule_c: "23", f1120s: "12" },
  utilities: { schedule_c: "25", f1120s: "19" },
  payroll: { schedule_c: "26", f1120s: "8" },
  other: { schedule_c: "27a (Part V)", f1120s: "19" },
  opex: { schedule_c: "28", f1120s: "20" },
  net_income: { schedule_c: "31", f1120s: "21" },
  sales_tax: { schedule_c: "—", f1120s: "—" },
};

export interface Statement {
  revenue: { pos: number; web: number; total: number };
  /** Sales tax collected: a liability to the state, NOT revenue. */
  sales_tax: number;
  gross_sales: number;
  sales_count: number;
  cogs: CogsCents & { items: number; total_all: number };
  gross_profit: number;
  opex: Record<Exclude<TaxCategory, "cost_of_goods">, number> & { card_fees: number; commissions: number; total: number };
  operating_income: number;
  net_income: number;
  /** The store result's figures over the same span (cents), for the indicators and the reconciliation. */
  memo: {
    /** Ejecutivo's «ganancia»: revenue − material cost − payment fees − commissions. */
    gross_contribution: number;
    /** The store result's contribution: the above − variable items (by hand and per sale). */
    contribution: number;
    fixed_total: number;
    variable_items: number;
    per_sale_items: number;
    /** Sales needed to cover the fixed costs (shared part included); null when the contribution margin is not positive. */
    break_even: number | null;
  };
  /** Percentages of revenue, one decimal; null when there is no revenue. */
  pct: { gross_margin: number | null; operating_margin: number | null; net_margin: number | null; contribution_margin: number | null };
}

const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** One statement from entity-months (any mix of stores, web and months). Pure; cents. */
export function statementOf(parts: readonly EntityMonth[]): Statement {
  const opex = Object.fromEntries(OPEX_CATEGORIES.map((c) => [c, 0])) as Statement["opex"];
  opex.card_fees = 0;
  opex.commissions = 0;
  opex.total = 0;
  const cogs = { ...emptyCogs(), items: 0, total_all: 0 };
  let pos = 0, web = 0, tax = 0, gross = 0, count = 0, fixed = 0, variableItems = 0, perSale = 0;
  for (const e of parts) {
    if (e.channel === "web") web += e.net_sales;
    else pos += e.net_sales;
    tax += e.sales_tax;
    gross += e.gross_sales;
    count += e.sales_count;
    for (const k of ["frames", "lenses", "treatments", "per_order", "total"] as const) cogs[k] += e.cogs[k];
    opex.card_fees += e.payment_fees;
    opex.commissions += e.commissions;
    for (const c of e.costs) {
      if (c.tax_category === "cost_of_goods") cogs.items += c.cents;
      else opex[c.tax_category] += c.cents;
      if (c.bucket === "variable") {
        variableItems += c.cents;
        if (c.per_sale) perSale += c.cents;
      } else fixed += c.cents;
    }
  }
  cogs.total_all = cogs.total + cogs.items;
  const revenue = pos + web;
  opex.total = OPEX_CATEGORIES.reduce((s, c) => s + opex[c], 0) + opex.card_fees + opex.commissions;
  const gross_profit = revenue - cogs.total_all;
  const operating_income = gross_profit - opex.total;
  const gross_contribution = revenue - cogs.total - opex.card_fees - opex.commissions;
  const contribution = gross_contribution - variableItems;
  const cm = revenue > 0 ? contribution / revenue : null;
  return {
    revenue: { pos, web, total: revenue },
    sales_tax: tax,
    gross_sales: gross,
    sales_count: count,
    cogs,
    gross_profit,
    opex,
    operating_income,
    // Pass-through business (sole proprietor / S corporation): no income tax at
    // the entity, no other income or expense recorded — net = operating.
    net_income: operating_income,
    memo: {
      gross_contribution,
      contribution,
      fixed_total: fixed,
      variable_items: variableItems,
      per_sale_items: perSale,
      // The break-even uses the UNROUNDED fraction (docs/CONTABILIDAD.md §0).
      break_even: cm && cm > 0 ? Math.round(fixed / cm) : null,
    },
    pct: {
      gross_margin: pct1(gross_profit, revenue),
      operating_margin: pct1(operating_income, revenue),
      net_margin: pct1(operating_income, revenue),
      contribution_margin: pct1(contribution, revenue),
    },
  };
}

/** A statement in dollars (every cents number ÷ 100 once; percentages untouched). */
export function statementDollars(s: Statement): Statement {
  const d = (v: number) => v / 100;
  const map = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, d(Number(v))])) as T;
  return {
    revenue: map(s.revenue),
    sales_tax: d(s.sales_tax),
    gross_sales: d(s.gross_sales),
    sales_count: s.sales_count,
    cogs: map(s.cogs),
    gross_profit: d(s.gross_profit),
    opex: map(s.opex),
    operating_income: d(s.operating_income),
    net_income: d(s.net_income),
    memo: { ...map({ gross_contribution: s.memo.gross_contribution, contribution: s.memo.contribution, fixed_total: s.memo.fixed_total, variable_items: s.memo.variable_items, per_sale_items: s.memo.per_sale_items }), break_even: s.memo.break_even === null ? null : d(s.memo.break_even) },
    pct: s.pct,
  };
}

export interface StatementEntity {
  id: string;
  code: string;
  name: string;
  color: string | null;
  kind: "store" | "web" | "total";
}

export interface FinancialStatement {
  from: string;
  to: string;
  group: StatementGroup;
  months: string[];
  periods: string[];
  entities: StatementEntity[];
  /** statements[period][entity] — "total" is the consolidated entity, "all" the whole span. */
  statements: Record<string, Record<string, Statement>>;
  tax_lines: typeof TAX_LINES;
  business: { name: string; legal_name: string; timezone: string; currency: string };
  generated_at: string;
}

/**
 * The statement document: one statement per period (and the whole span,
 * key "all") per entity (each store, «web», and «total» = consolidated). Pure;
 * cents (the route divides).
 */
export function buildStatement(ledger: readonly LedgerMonth[], group: StatementGroup, entities: StatementEntity[]): Omit<FinancialStatement, "from" | "to" | "business" | "generated_at" | "tax_lines"> {
  const periods: string[] = [];
  const bucket = new Map<string, EntityMonth[]>();
  const push = (period: string, entity: string, e: EntityMonth) => {
    const k = `${period}|${entity}`;
    const list = bucket.get(k);
    if (list) list.push(e);
    else bucket.set(k, [e]);
  };
  const ids = entities.filter((e) => e.kind !== "total").map((e) => e.id);
  for (const lm of ledger) {
    const period = periodKeyOf(lm.month, group);
    if (!periods.includes(period)) periods.push(period);
    for (const id of ids) {
      const e = lm.entities.get(id);
      if (!e) continue;
      push(period, id, e);
      push(period, "total", e);
      push("all", id, e);
      push("all", "total", e);
    }
  }
  const statements: Record<string, Record<string, Statement>> = {};
  for (const period of [...periods, "all"]) {
    statements[period] = {};
    for (const ent of entities) statements[period][ent.id] = statementOf(bucket.get(`${period}|${ent.id}`) ?? []);
  }
  return { group, months: ledger.map((l) => l.month), periods, entities, statements };
}

// ── Loading ──────────────────────────────────────────────────────────────────

export interface LoadedLedger {
  ledger: LedgerMonth[];
  stores: EstablishmentRow[];
  /** Stores in view that have figures or are active (the ones the screens list). */
  shownStores: EstablishmentRow[];
  rules: CostRule[];
}

/**
 * Reads everything a span of months needs, in a handful of queries for the
 * whole span (not per month), and runs `ledgerOf`. `storeIds` null = every
 * store. Till sales only unless `web`.
 */
export async function loadLedger(container: MedusaContainer, months: string[], storeIds: string[] | null, opts: { web?: boolean } = {}): Promise<LoadedLedger> {
  const pg = pgOf(container);
  const tz = tenant().timezone;
  const web = Boolean(opts.web);
  const everyStore = await listEstablishments(container);
  const activeStoreIds = everyStore.filter((s) => s.is_active).map((s) => s.id);
  const inView = everyStore.filter((s) => storeIds === null || storeIds.includes(s.id));
  const ids = inView.map((s) => s.id);
  const first = `${months[0]}-01`;
  const last = lastDayOf(months[months.length - 1]);

  const facts = (await pg("sale_fact")
    .whereNull("deleted_at")
    .where("status", "active")
    .where((q) => {
      q.where((p) => p.where("channel", "pos").whereIn("establishment_id", ids.length ? ids : ["-"]));
      if (web) q.orWhere("channel", "web");
    })
    .where("sold_date_local", ">=", first)
    .where("sold_date_local", "<=", last)
    .select("order_id", "channel", "establishment_id", "seller_id", "seller_code", "product_id", "sku", "qty", "total_cents", "tax_cents", "lens_design", "lens_material", "lens_photo", "lens_ar", "lens_finish", "sold_date_local")) as Array<Record<string, unknown>>;
  const lines: LedgerFact[] = facts.map((f) => ({
    order_id: String(f.order_id),
    channel: String(f.channel),
    establishment_id: (f.establishment_id as string | null) ?? null,
    seller_id: (f.seller_id as string | null) ?? null,
    seller_code: (f.seller_code as string | null) ?? null,
    product_id: (f.product_id as string | null) ?? null,
    sku: (f.sku as string | null) ?? null,
    qty: Number(f.qty),
    total_cents: Number(f.total_cents),
    tax_cents: Number(f.tax_cents),
    lens_design: (f.lens_design as string | null) ?? null,
    lens_material: (f.lens_material as string | null) ?? null,
    lens_photo: (f.lens_photo as string | null) ?? null,
    lens_ar: (f.lens_ar as string | null) ?? null,
    lens_finish: (f.lens_finish as string | null) ?? null,
    sold_date_local: String(f.sold_date_local),
  }));

  // Payment fees: the window is two days wider on each side so no time zone
  // cuts a payment off; `sumFeesByStore` keeps the local month.
  const winFrom = new Date(Date.parse(`${first}T00:00:00Z`) - 2 * 86400_000);
  const winTo = new Date(Date.parse(`${last}T00:00:00Z`) + 3 * 86400_000);
  const sellerIds = [...new Set(lines.map((l) => l.seller_id).filter((v): v is string => Boolean(v)))];
  const [rules, meta, pays, items, profiles, sellerRows, defaultPct] = await Promise.all([
    listCostRules(container),
    loadProductMetadata(pg, [...new Set(lines.map((l) => String(l.product_id ?? "")).filter(Boolean))]),
    pg("pos_sale_payment as p")
      .leftJoin("pos_sale as s", "s.id", "p.sale_id")
      .whereNull("p.deleted_at")
      .whereIn("p.establishment_id", ids.length ? ids : ["-"])
      .whereBetween("p.created_at", [winFrom, winTo])
      .select("p.establishment_id", "p.fee_cents", "p.created_at", "s.status as sale_status") as Promise<Array<Record<string, unknown>>>,
    container.resolve<StoreCostModuleService>(STORE_COST_MODULE).listCostItems({}, { take: 5000 }) as unknown as Promise<LedgerItem[]>,
    profilesByUser(container, sellerIds),
    listSellers(container).catch(() => []),
    loadDefaultCommissionPct(container),
  ]);
  const sellerByCode = new Map(sellerRows.map((s) => [s.code, { commission_pct: s.commission_pct }]));
  const pctOf = commissionResolverOf(profiles, sellerByCode, defaultPct);

  // Weights of a charge shared "by sales": the net of EVERY active store each
  // month, not only of the stores in view. One extra aggregate, and only when
  // the view is narrower than the chain.
  const liveItems = (items as LedgerItem[]).filter((it) => !(it as unknown as { deleted_at?: unknown }).deleted_at);
  const needsWeights = liveItems.some((it) => !it.establishment_id && it.allocation?.method !== "percent") && ids.length !== activeStoreIds.length;
  let netByMonthStore: Map<string, Map<string, number>> | undefined;
  if (needsWeights && activeStoreIds.length) {
    const rows = (await pg("sale_fact")
      .whereNull("deleted_at")
      .where("status", "active")
      .where("channel", "pos")
      .whereIn("establishment_id", activeStoreIds)
      .where("sold_date_local", ">=", first)
      .where("sold_date_local", "<=", last)
      .groupByRaw("substring(sold_date_local, 1, 7), establishment_id")
      .select(pg.raw("substring(sold_date_local, 1, 7) AS month"), "establishment_id", pg.raw("SUM(total_cents - tax_cents)::bigint AS net"))) as Array<Record<string, unknown>>;
    netByMonthStore = new Map(months.map((m) => [m, new Map<string, number>()]));
    for (const r of rows) netByMonthStore.get(String(r.month))?.set(String(r.establishment_id), Number(r.net));
  }

  const ledger = ledgerOf({
    months,
    facts: lines,
    pays: pays as unknown as FeeRowLike[],
    rules,
    items: liveItems.map((it) => ({ ...it, amount_cents: Number(it.amount_cents) })),
    brandOf: (id) => {
      const m = meta.get(String(id ?? "")) ?? {};
      return ((m.brand_slug ?? m.collection_slug) as string | undefined) ?? null;
    },
    pctOf,
    storeIds: ids,
    activeStoreIds,
    netByMonthStore,
    tz,
    web,
  });

  // A deactivated store keeps its history: it stays in the months it still
  // has sales or costs in, and disappears from the months where it has nothing.
  const hasFigures = (id: string) =>
    ledger.some((lm) => {
      const e = lm.entities.get(id);
      return Boolean(e && (e.net_sales || e.cogs.total || e.payment_fees || e.commissions || e.sales_count || e.costs.some((c) => c.cents)));
    });
  const shownStores = inView.filter((s) => s.is_active || hasFigures(s.id));
  return { ledger, stores: everyStore, shownStores, rules };
}

/** The statement document for a span, a store selection and a grouping (cents). */
export async function financialStatement(
  container: MedusaContainer,
  input: { from: string; to: string; group: StatementGroup; storeIds: string[] | null; web: boolean }
): Promise<FinancialStatement> {
  const months = monthsBetween(input.from, input.to).slice(0, MAX_STATEMENT_MONTHS);
  const { ledger, shownStores } = await loadLedger(container, months, input.storeIds, { web: input.web });
  const t = tenant();
  const entities: StatementEntity[] = [
    ...shownStores.map((s) => ({ id: s.id, code: s.code, name: s.name, color: s.color ?? null, kind: "store" as const })),
    ...(input.web ? [{ id: WEB_ENTITY, code: "WEB", name: "Online", color: null, kind: "web" as const }] : []),
    { id: "total", code: "TOTAL", name: "Consolidated", color: null, kind: "total" },
  ];
  const doc = buildStatement(ledger, input.group, entities);
  return {
    ...doc,
    from: `${months[0]}-01`,
    to: lastDayOf(months[months.length - 1]),
    tax_lines: TAX_LINES,
    business: { name: t.name, legal_name: t.legalName, timezone: t.timezone, currency: t.currency.toUpperCase() },
    generated_at: new Date().toISOString(),
  };
}
