/**
 * Patient file («Pacientes», docs/PATIENTS.md): what a person bought, how much
 * they spent and how their prescription is moving, as numbers and codes only.
 * Pure: no container, no database (src/lib/patient-history-data.ts loads it).
 *
 * The purchases come from `sale_fact` (one row per sold line, POS and web), so
 * the file covers both channels with the same totals the dashboards use. A
 * voided sale is listed (greyed on screen) but never counts in totals.
 */

export interface PatientFactLike {
  order_id: string;
  sale_id: string | null;
  sale_number: string | null;
  channel: string;
  establishment_id: string | null;
  title: string | null;
  brand: string | null;
  category: string;
  lens_design: string | null;
  lens_material: string | null;
  lens_photo: string | null;
  lens_ar: string | null;
  has_prescription: boolean;
  qty: number;
  list_cents: number;
  discount_cents: number;
  total_cents: number;
  status: string;
  sold_at: string | Date;
}

export interface PurchaseLine {
  title: string | null;
  brand: string | null;
  category: string;
  lens: { design: string | null; material: string | null; photo: string | null; ar: string | null } | null;
  qty: number;
  total_cents: number;
}

export interface Purchase {
  order_id: string;
  sale_id: string | null;
  sale_number: string | null;
  channel: "pos" | "web";
  establishment_id: string | null;
  sold_at: string;
  status: "active" | "voided";
  total_cents: number;
  discount_cents: number;
  has_prescription: boolean;
  lines: PurchaseLine[];
}

/** «Good customer» bands. Owner-tunable later; today constants (docs/PATIENTS.md). */
export const PATIENT_RULES = Object.freeze({
  /** Purchases or money from which a patient is VIP. */
  vipPurchases: 3,
  vipTotalCents: 80_000,
  /** Months without buying after which a patient is «inactive» (recall). */
  lapsedMonths: 24,
  /** Months after the last prescription when a new eye exam is due. */
  examMonths: 12,
});

export type PatientTier = "none" | "new" | "returning" | "vip";

export interface PatientSummary {
  /** Purchases that count (not voided). */
  purchases: number;
  voided: number;
  total_cents: number;
  /** Average ticket over the purchases that count; null without any. */
  avg_cents: number | null;
  discount_cents: number;
  first_at: string | null;
  last_at: string | null;
  months_since_last: number | null;
  /** Purchases and money per store (POS) and online, biggest first. */
  stores: Array<{ establishment_id: string | null; channel: "pos" | "web"; purchases: number; total_cents: number }>;
  /** The store where most purchases were made (null = online or none). */
  main_store: string | null;
  with_prescription: number;
  tier: PatientTier;
  lapsed: boolean;
}

const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const channelOf = (c: string): "pos" | "web" => (c === "pos" ? "pos" : "web");

/** Whole months between two instants (b after a), never negative. */
export function monthsBetween(a: string | Date, b: string | Date): number {
  const x = new Date(a);
  const y = new Date(b);
  let m = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth());
  if (y.getUTCDate() < x.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/** Sold lines → one purchase per order, newest first. A purchase is voided when all its lines are. */
export function groupPurchases(facts: readonly PatientFactLike[]): Purchase[] {
  const byOrder = new Map<string, Purchase>();
  for (const f of facts) {
    let p = byOrder.get(f.order_id);
    if (!p) {
      p = {
        order_id: f.order_id,
        sale_id: f.sale_id ?? null,
        sale_number: f.sale_number ?? null,
        channel: channelOf(f.channel),
        establishment_id: f.establishment_id ?? null,
        sold_at: iso(f.sold_at),
        status: "voided",
        total_cents: 0,
        discount_cents: 0,
        has_prescription: false,
        lines: [],
      };
      byOrder.set(f.order_id, p);
    }
    const active = f.status !== "voided";
    if (active) p.status = "active";
    // A voided sale keeps its amounts on screen; totals of the file skip it.
    p.total_cents += Number(f.total_cents) || 0;
    p.discount_cents += Number(f.discount_cents) || 0;
    p.has_prescription = p.has_prescription || Boolean(f.has_prescription);
    if (iso(f.sold_at) < p.sold_at) p.sold_at = iso(f.sold_at);
    const lensy = f.lens_design || f.lens_material || f.lens_photo || f.lens_ar;
    p.lines.push({
      title: f.title ?? null,
      brand: f.brand ?? null,
      category: f.category,
      lens: lensy ? { design: f.lens_design ?? null, material: f.lens_material ?? null, photo: f.lens_photo ?? null, ar: f.lens_ar ?? null } : null,
      qty: Number(f.qty) || 1,
      total_cents: Number(f.total_cents) || 0,
    });
  }
  return [...byOrder.values()].sort((a, b) => (a.sold_at < b.sold_at ? 1 : a.sold_at > b.sold_at ? -1 : 0));
}

export function tierOf(purchases: number, totalCents: number): PatientTier {
  if (purchases <= 0) return "none";
  if (purchases >= PATIENT_RULES.vipPurchases || totalCents >= PATIENT_RULES.vipTotalCents) return "vip";
  return purchases >= 2 ? "returning" : "new";
}

/** Totals, average ticket, stores and the customer band of a patient. */
export function summarize(purchases: readonly Purchase[], now: Date = new Date()): PatientSummary {
  const live = purchases.filter((p) => p.status === "active");
  const total = live.reduce((s, p) => s + p.total_cents, 0);
  const dates = live.map((p) => p.sold_at).sort();
  const last = dates.length ? dates[dates.length - 1] : null;
  const per = new Map<string, { establishment_id: string | null; channel: "pos" | "web"; purchases: number; total_cents: number }>();
  for (const p of live) {
    const k = p.channel === "web" ? "web" : `pos:${p.establishment_id ?? ""}`;
    const row = per.get(k) ?? { establishment_id: p.channel === "web" ? null : p.establishment_id, channel: p.channel, purchases: 0, total_cents: 0 };
    row.purchases += 1;
    row.total_cents += p.total_cents;
    per.set(k, row);
  }
  const stores = [...per.values()].sort((a, b) => b.purchases - a.purchases || b.total_cents - a.total_cents);
  const months = last ? monthsBetween(last, now) : null;
  return {
    purchases: live.length,
    voided: purchases.length - live.length,
    total_cents: total,
    avg_cents: live.length ? Math.round(total / live.length) : null,
    discount_cents: live.reduce((s, p) => s + p.discount_cents, 0),
    first_at: dates[0] ?? null,
    last_at: last,
    months_since_last: months,
    stores,
    main_store: stores.find((s) => s.channel === "pos")?.establishment_id ?? null,
    with_prescription: live.filter((p) => p.has_prescription).length,
    tier: tierOf(live.length, total),
    lapsed: months != null && months >= PATIENT_RULES.lapsedMonths,
  };
}

/**
 * When the next eye exam is due: `examMonths` after the last prescription's
 * date (its stored date, else when it was recorded). null without one.
 */
export function examDue(lastRx: { rx_date: string | null; created_at: string } | null, now: Date = new Date()): { due_on: string; overdue: boolean } | null {
  if (!lastRx) return null;
  const base = new Date(lastRx.rx_date ? `${lastRx.rx_date}T12:00:00Z` : lastRx.created_at);
  if (Number.isNaN(base.getTime())) return null;
  const due = new Date(base);
  due.setUTCMonth(due.getUTCMonth() + PATIENT_RULES.examMonths);
  const dueOn = due.toISOString().slice(0, 10);
  return { due_on: dueOn, overdue: dueOn <= now.toISOString().slice(0, 10) };
}

/** List row of «Pacientes» from the SQL aggregate of sale_fact. */
export interface PatientListAgg {
  customer_id: string;
  purchases: number;
  total_cents: number;
  first_at: string | Date | null;
  last_at: string | Date | null;
}

export function listRow(agg: PatientListAgg, now: Date = new Date()): { purchases: number; total_cents: number; avg_cents: number | null; first_at: string | null; last_at: string | null; tier: PatientTier; lapsed: boolean } {
  const purchases = Number(agg.purchases) || 0;
  const total = Number(agg.total_cents) || 0;
  const last = agg.last_at ? iso(agg.last_at) : null;
  return {
    purchases,
    total_cents: total,
    avg_cents: purchases ? Math.round(total / purchases) : null,
    first_at: agg.first_at ? iso(agg.first_at) : null,
    last_at: last,
    tier: tierOf(purchases, total),
    lapsed: last != null && monthsBetween(last, now) >= PATIENT_RULES.lapsedMonths,
  };
}
