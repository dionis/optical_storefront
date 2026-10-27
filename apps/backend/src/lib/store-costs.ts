/**
 * Store costs and the monthly result (functional document E13, HU-91 to
 * HU-96). Pure — no I/O; store-pnl.ts loads the data. Amounts in cents.
 */

export const COST_FREQUENCIES = ["monthly", "quarterly", "annual", "one_time"] as const;
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

export interface CostItemLike {
  establishment_id: string | null;
  kind: "fixed" | "variable";
  amount_cents: number;
  frequency: (typeof COST_FREQUENCIES)[number];
  amortize_months: number | null;
  starts_on: string;
  ends_on: string | null;
  allocation: { method: "percent"; shares: Record<string, number> } | { method: "sales" } | null;
}

const monthIndex = (yyyyMm: string) => Number(yyyyMm.slice(0, 4)) * 12 + Number(yyyyMm.slice(5, 7)) - 1;

/** What an item costs in a month (YYYY-MM): frequency, validity and amortization. */
export function monthlyCharge(item: CostItemLike, month: string): number {
  const m = monthIndex(month);
  const start = monthIndex(item.starts_on.slice(0, 7));
  const end = item.ends_on ? monthIndex(item.ends_on.slice(0, 7)) : Infinity;
  if (m < start || m > end) return 0;
  switch (item.frequency) {
    case "monthly":
      return item.amount_cents;
    case "quarterly":
      return Math.round(item.amount_cents / 3);
    case "annual":
      return Math.round(item.amount_cents / 12);
    case "one_time": {
      const n = item.amortize_months && item.amortize_months > 1 ? item.amortize_months : 1;
      return m - start < n ? Math.round(item.amount_cents / n) : 0;
    }
  }
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
export function cleanCostItem(b: Record<string, unknown> | null | undefined, knownStores: string[]): { reason: string } | { item: Omit<CostItemLike, "amount_cents"> & { amount_cents: number; category: string; description: string | null; vendor: string | null; notes: string | null } } {
  const x = b ?? {};
  const est = x.establishment_id === null || x.establishment_id === "" || x.establishment_id === undefined ? null : String(x.establishment_id);
  if (est && !knownStores.includes(est)) return { reason: "bad_store" };
  const kind = x.kind === "variable" ? "variable" : x.kind === "fixed" ? "fixed" : null;
  if (!kind) return { reason: "bad_kind" };
  const category = String(x.category ?? "");
  if (!(COST_CATEGORIES as readonly string[]).includes(category)) return { reason: "bad_category" };
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
