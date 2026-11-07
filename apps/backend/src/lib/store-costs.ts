/**
 * Store costs and the monthly result (functional document E13, HU-91 to
 * HU-96). Pure — no I/O; store-pnl.ts loads the data. Amounts in cents.
 *
 * 7-nov-2026 («Reglas y comisiones» en acordeones + estado de resultados):
 *  - frequencies daily / weekly / biweekly join monthly / quarterly / annual /
 *    one_time. Each one has a MONTHLY NORMALISATION (`MONTHLY_FACTOR`):
 *      daily × 365/12 (30.4167) · weekly × 52/12 · biweekly × 26/12 ·
 *      monthly × 1 · quarterly ÷ 3 · annual ÷ 12 · one_time in its month (or
 *      spread over `amortize_months`).
 *    The month's charge is spread with a running round (`spreadCents`), so a
 *    year of an annual item adds up to its amount EXACTLY (1,000.00 / 12 is
 *    83.33 + … + 83.37, never 12 × 83.33 = 999.96): a statement for the IRS
 *    that is a few cents short of the invoice is a statement nobody signs.
 *  - `active` false keeps the item (and its history) and leaves it out of every
 *    figure; deleting is still soft.
 *  - `per_sale` true: the amount is charged ON EACH SALE of the store in the
 *    month («se cobra en cada venta»: bag, cleaning cloth, card terminal fee
 *    per ticket…). Its frequency is then ignored; it is always a variable cost.
 *  - `tax_category` is the IRS-style bucket of the financial statement
 *    (lib/financial-statement.ts), with a Schedule C / Form 1120-S line each.
 *    Rows written before it existed read it from their `category`
 *    (`taxCategoryOf`, the same map the migration used to backfill them).
 */

export const COST_FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "annual", "one_time"] as const;
export type CostFrequency = (typeof COST_FREQUENCIES)[number];

/** Monthly normalisation of each frequency, as a fraction (numerator / denominator) so no float drifts. */
export const MONTHLY_FACTOR: Record<Exclude<CostFrequency, "one_time">, readonly [number, number]> = {
  daily: [365, 12],
  weekly: [52, 12],
  biweekly: [26, 12],
  monthly: [1, 1],
  quarterly: [1, 3],
  annual: [1, 12],
};

export const COST_CATEGORIES = [
  "rent",
  "maintenance",
  "utilities",
  "salaries",
  "insurance",
  "licenses",
  "subscriptions",
  "equipment",
  "supplies",
  "shipping",
  "repairs",
  "remakes",
  "accounting",
  "other",
] as const;

/** IRS-style buckets of the financial statement (Schedule C Part II / Form 1120-S deductions). */
export const TAX_CATEGORIES = [
  "cost_of_goods",
  "rent",
  "utilities",
  "payroll",
  "payroll_taxes",
  "insurance",
  "advertising",
  "software",
  "professional_fees",
  "bank_fees",
  "repairs",
  "supplies",
  "taxes_licenses",
  "depreciation",
  "other",
] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

/**
 * The owner's category → the tax bucket. Used to backfill the rows written
 * before `tax_category` existed (migration StoreCostFinance2) and as the
 * fallback of a row that still has none. Choices an accountant would make:
 * a remake (lens redone) is cost of goods; equipment is depreciated (Form
 * 4562); shipping has no line of its own and goes to other expenses.
 */
export const CATEGORY_TAX: Record<(typeof COST_CATEGORIES)[number], TaxCategory> = {
  rent: "rent",
  maintenance: "repairs",
  utilities: "utilities",
  salaries: "payroll",
  insurance: "insurance",
  licenses: "taxes_licenses",
  subscriptions: "software",
  equipment: "depreciation",
  supplies: "supplies",
  shipping: "other",
  repairs: "repairs",
  remakes: "cost_of_goods",
  accounting: "professional_fees",
  other: "other",
};

/** The tax bucket of an item: its own, or the one its category maps to. */
export function taxCategoryOf(item: { tax_category?: string | null; category?: string | null }): TaxCategory {
  const own = item.tax_category ?? "";
  if ((TAX_CATEGORIES as readonly string[]).includes(own)) return own as TaxCategory;
  return CATEGORY_TAX[(item.category ?? "") as (typeof COST_CATEGORIES)[number]] ?? "other";
}

/** A tax bucket back to the closest owner's category, for an item created from the statement side (or an import). */
export const TAX_DEFAULT_CATEGORY: Record<TaxCategory, (typeof COST_CATEGORIES)[number]> = {
  cost_of_goods: "remakes",
  rent: "rent",
  utilities: "utilities",
  payroll: "salaries",
  payroll_taxes: "salaries",
  insurance: "insurance",
  advertising: "other",
  software: "subscriptions",
  professional_fees: "accounting",
  bank_fees: "other",
  repairs: "repairs",
  supplies: "supplies",
  taxes_licenses: "licenses",
  depreciation: "equipment",
  other: "other",
};

export interface CostItemLike {
  establishment_id: string | null;
  kind: "fixed" | "variable";
  amount_cents: number;
  frequency: CostFrequency;
  amortize_months: number | null;
  starts_on: string;
  ends_on: string | null;
  allocation: { method: "percent"; shares: Record<string, number> } | { method: "sales" } | null;
  /** Absent = active (rows and callers older than the flag). */
  active?: boolean | null;
  /** Charged on each sale instead of by time («se cobra en cada venta»). */
  per_sale?: boolean | null;
  category?: string | null;
  tax_category?: string | null;
}

const monthIndex = (yyyyMm: string) => Number(yyyyMm.slice(0, 4)) * 12 + Number(yyyyMm.slice(5, 7)) - 1;

/**
 * Part `i` (0-based) of an amount spread at `num/den` per period, with a
 * running round: Σ parts 0..n−1 = round(n × amount × num / den), so whole
 * cycles add up exactly. Pure, integer cents in and out.
 */
export function spreadCents(amountCents: number, num: number, den: number, i: number): number {
  if (i < 0) return 0;
  const at = (k: number) => Math.round((amountCents * num * k) / den);
  return at(i + 1) - at(i);
}

/** Whether the item is inside its validity in a month (YYYY-MM); the validity is read by month, not by day. */
export function inValidity(item: Pick<CostItemLike, "starts_on" | "ends_on">, month: string): boolean {
  const m = monthIndex(month);
  const start = monthIndex(item.starts_on.slice(0, 7));
  const end = item.ends_on ? monthIndex(item.ends_on.slice(0, 7)) : Infinity;
  return m >= start && m <= end;
}

/**
 * What an item costs in a month (YYYY-MM): frequency, validity and
 * amortization. 0 for an inactive item and for a per-sale one (that one is
 * `perSaleCharge`, it needs the month's sales).
 */
export function monthlyCharge(item: CostItemLike, month: string): number {
  if (item.active === false || item.per_sale) return 0;
  if (!inValidity(item, month)) return 0;
  const i = monthIndex(month) - monthIndex(item.starts_on.slice(0, 7));
  if (item.frequency === "one_time") {
    const n = item.amortize_months && item.amortize_months > 1 ? item.amortize_months : 1;
    return i < n ? spreadCents(item.amount_cents, 1, n, i) : 0;
  }
  const f = MONTHLY_FACTOR[item.frequency] ?? MONTHLY_FACTOR.monthly;
  return spreadCents(item.amount_cents, f[0], f[1], i);
}

/** A per-sale item in a month: its amount × the sales the store made (0 when inactive or out of validity). */
export function perSaleCharge(item: CostItemLike, month: string, salesCount: number): number {
  if (item.active === false || !item.per_sale) return 0;
  if (!inValidity(item, month)) return 0;
  return Math.max(0, Math.round(item.amount_cents)) * Math.max(0, Math.floor(salesCount));
}

/**
 * The monthly normalised amount of an item, for the accordion headers and
 * the «Mensual» column: what the frequency is worth in an average month
 * (not the running-rounded charge of a given month). A one-time item is
 * shown as its amount ÷ its amortization months; a per-sale item as its amount
 * × `salesPerMonth` (the store's sales this month), or the amount alone.
 * Cents, rounded once.
 */
export function normalizedMonthly(item: Pick<CostItemLike, "amount_cents" | "frequency" | "amortize_months" | "per_sale">, salesPerMonth: number | null = null): number {
  if (item.per_sale) return salesPerMonth === null ? item.amount_cents : item.amount_cents * Math.max(0, Math.floor(salesPerMonth));
  if (item.frequency === "one_time") {
    const n = item.amortize_months && item.amortize_months > 1 ? item.amortize_months : 1;
    return Math.round(item.amount_cents / n);
  }
  const f = MONTHLY_FACTOR[item.frequency] ?? MONTHLY_FACTOR.monthly;
  return Math.round((item.amount_cents * f[0]) / f[1]);
}

/**
 * A shared charge split among stores (HU-95): by fixed percentages, or in
 * proportion to what each store sold (equal parts when nothing sold).
 */
export function allocateShared(chargeCents: number, allocation: CostItemLike["allocation"], storeIds: string[], salesByStore: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (!storeIds.length || chargeCents === 0) return out;
  let weights: number[];
  if (allocation?.method === "percent") {
    weights = storeIds.map((id) => Math.max(0, Number(allocation.shares[id] ?? 0)));
  } else {
    weights = storeIds.map((id) => Math.max(0, salesByStore.get(id) ?? 0));
  }
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) weights = storeIds.map(() => 1);
  const sum = weights.reduce((s, w) => s + w, 0);
  // Largest remainder, so the parts add up to the charge exactly.
  const raw = weights.map((w) => (chargeCents * w) / sum);
  const floor = raw.map(Math.floor);
  let left = chargeCents - floor.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; floor[i]++; left--; }
  storeIds.forEach((id, i) => out.set(id, floor[i]));
  return out;
}

export interface PnlInput {
  net_sales: number;
  cogs: number;
  payment_fees: number;
  commissions: number;
  variable_manual: number;
  fixed: number;
  shared: number;
}

export interface Pnl extends PnlInput {
  variable_total: number;
  contribution: number;
  contribution_pct: number | null;
  fixed_total: number;
  result: number;
  /** Sales needed to cover the fixed costs (shared part included); null when the margin is not positive. */
  break_even: number | null;
}

/** Monthly result and break-even point = fixed ÷ contribution margin % (HU-96). */
export function computePnl(i: PnlInput): Pnl {
  const variable_total = i.payment_fees + i.commissions + i.variable_manual;
  const contribution = i.net_sales - i.cogs - variable_total;
  const contribution_pct = i.net_sales > 0 ? contribution / i.net_sales : null;
  const fixed_total = i.fixed + i.shared;
  return {
    ...i,
    variable_total,
    contribution,
    contribution_pct: contribution_pct === null ? null : Math.round(contribution_pct * 1000) / 10,
    fixed_total,
    result: contribution - fixed_total,
    break_even: contribution_pct && contribution_pct > 0 ? Math.round(fixed_total / contribution_pct) : null,
  };
}

/** Validation of a cost item as written in the panel; reason code or the clean item. */
export interface CleanCostItem extends Omit<CostItemLike, "amount_cents" | "active" | "per_sale" | "category" | "tax_category"> {
  amount_cents: number;
  category: string;
  tax_category: TaxCategory;
  active: boolean;
  per_sale: boolean;
  description: string | null;
  vendor: string | null;
  notes: string | null;
}

export function cleanCostItem(b: Record<string, unknown> | null | undefined, knownStores: string[]): { reason: string } | { item: CleanCostItem } {
  const x = b ?? {};
  const est = x.establishment_id === null || x.establishment_id === "" || x.establishment_id === undefined ? null : String(x.establishment_id);
  if (est && !knownStores.includes(est)) return { reason: "bad_store" };
  const kind = x.kind === "variable" ? "variable" : x.kind === "fixed" ? "fixed" : null;
  if (!kind) return { reason: "bad_kind" };
  // The tax bucket may come alone (a row added from the «Impuestos» accordion
  // or an import that only knows the IRS line): the owner's category follows it.
  const taxRaw = x.tax_category === undefined || x.tax_category === null || x.tax_category === "" ? null : String(x.tax_category);
  if (taxRaw !== null && !(TAX_CATEGORIES as readonly string[]).includes(taxRaw)) return { reason: "bad_tax_category" };
  const category = String(x.category ?? (taxRaw ? TAX_DEFAULT_CATEGORY[taxRaw as TaxCategory] : ""));
  if (!(COST_CATEGORIES as readonly string[]).includes(category)) return { reason: "bad_category" };
  const tax_category = (taxRaw as TaxCategory | null) ?? CATEGORY_TAX[category as (typeof COST_CATEGORIES)[number]];
  const flag = (v: unknown, dflt: boolean) => (v === undefined || v === null || v === "" ? dflt : v === true || v === "true" || v === 1 || v === "1");
  const amount = Number(x.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return { reason: "bad_amount" };
  const frequency = String(x.frequency ?? "monthly");
  if (!(COST_FREQUENCIES as readonly string[]).includes(frequency)) return { reason: "bad_frequency" };
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const starts_on = String(x.starts_on ?? "");
  if (!day.test(starts_on)) return { reason: "bad_date" };
  const ends_on = x.ends_on ? String(x.ends_on) : null;
  if (ends_on && (!day.test(ends_on) || ends_on < starts_on)) return { reason: "bad_date" };
  const am = x.amortize_months === undefined || x.amortize_months === null || x.amortize_months === "" ? null : Number(x.amortize_months);
  if (am !== null && (!Number.isInteger(am) || am < 1 || am > 120)) return { reason: "bad_amortization" };
  let allocation: CostItemLike["allocation"] = null;
  if (!est) {
    const a = (x.allocation ?? {}) as Record<string, unknown>;
    if (a.method === "percent") {
      const shares: Record<string, number> = {};
      for (const [k, v] of Object.entries((a.shares ?? {}) as Record<string, unknown>)) {
        if (!knownStores.includes(k)) return { reason: "bad_store" };
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) return { reason: "bad_allocation" };
        if (n > 0) shares[k] = n;
      }
      const total = Object.values(shares).reduce((s, v) => s + v, 0);
      if (Math.abs(total - 100) > 0.01) return { reason: "bad_allocation" };
      allocation = { method: "percent", shares };
    } else allocation = { method: "sales" };
  }
  const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    item: {
      establishment_id: est,
      kind,
      category,
      tax_category,
      active: flag(x.active, true),
      per_sale: flag(x.per_sale, false),
      description: txt(x.description, 160),
      amount_cents: Math.round(amount * 100),
      frequency: frequency as CostItemLike["frequency"],
      amortize_months: am,
      starts_on,
      ends_on,
      vendor: txt(x.vendor, 120),
      allocation,
      notes: txt(x.notes, 500),
    },
  };
}
