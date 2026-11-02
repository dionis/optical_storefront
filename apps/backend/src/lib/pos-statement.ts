import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { localParts } from "./alerts";
import type { EstablishmentRow } from "./establishments";
import { listPaymentMethods, PosError } from "./pos-data";
import { tenant } from "./tenant";

/**
 * Estado de cuenta (statement) of a store for a period: every till sale of the
 * period with its lines and payments, the period totals (by payment method,
 * seller and day) and the settlement of a family/partner/consignment store.
 *
 * Loading reads the tables directly (pos_sale, pos_sale_payment, sale_fact,
 * order_line_item, customer); everything after the queries is pure and tested
 * with fixtures (tests/pos-statement.test.ts). Amounts in cents. Voided sales
 * are listed with their status and excluded from every total but
 * `voided_count`. Dates are calendar days in the tenant time zone.
 */

export const MAX_STATEMENT_SALES = 2000;

export interface StatementItem {
  title: string;
  brand: string | null;
  variant: string | null;
  /** frame | case | own_frame */
  kind: string;
  qty: number;
  frame_cents: number;
  lens_cents: number;
  list_cents: number;
  /** Lens codes; the panel resolves their labels with the lens catalog. Null = frame only. */
  lens: { design: string | null; material: string | null; photo: string | null; ar: string | null } | null;
}

export interface StatementPayment {
  method_code: string;
  /** Owner-added methods carry their own name; built-in ones are null (panel: adm.pos.method.<code>). */
  method: { es: string; en: string } | null;
  kind: string;
  amount_cents: number;
  reference: string | null;
  at: string;
}

export interface StatementSale {
  id: string;
  number: string;
  store_code: string;
  /** ISO instant of the sale. */
  date: string;
  /** Calendar day of the sale in the tenant time zone. */
  day: string;
  seller_code: string | null;
  customer_name: string | null;
  delivery: string;
  status: string;
  items: StatementItem[];
  list_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  insurance_cents: number;
  balance_cents: number;
  payments: StatementPayment[];
}

export interface StatementTotals {
  count: number;
  voided_count: number;
  list_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  insurance_cents: number;
  balance_cents: number;
  by_method: Array<{ code: string; label: { es: string; en: string } | null; cents: number }>;
  by_seller: Array<{ seller_code: string | null; count: number; total_cents: number }>;
  by_day: Array<{ date: string; count: number; total_cents: number }>;
}

export interface Settlement {
  pct: number;
  /** Net sales of the period (total − tax) of completed sales, as store-pnl.ts computes the store's share. */
  base_cents: number;
  amount_cents: number;
}

export interface StatementStore {
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  kind: string;
  settlement_pct: number | null;
  receipt_note: string | null;
}

export interface Statement {
  number: string;
  store: StatementStore;
  business: { name: string; legal_name: string; address: string | null; url: string };
  period: { from: string; to: string };
  generated_at: string;
  sales: StatementSale[];
  totals: StatementTotals;
  settlement: Settlement | null;
  /**
   * More sales than MAX_STATEMENT_SALES in the period. The listing AND the
   * totals are then partial (the totals are the sum of the sales listed, which
   * is what keeps `by_seller` / `by_day` adding up to them). A statement is a
   * document: the panel must show this, never print a short total in silence.
   */
  truncated: boolean;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Last calendar day of the month of a YYYY-MM-DD. */
export function monthEnd(day: string): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** The period from the query: both days, or the whole current month; from ≤ to or `bad_range`. */
export function periodFromQuery(q: { from?: unknown; to?: unknown }, today: string): { from: string; to: string } {
  const from = typeof q.from === "string" && DAY.test(q.from) ? q.from : null;
  const to = typeof q.to === "string" && DAY.test(q.to) ? q.to : null;
  if ((q.from && !from) || (q.to && !to)) throw new PosError("bad_range");
  const period = { from: from ?? `${(to ?? today).slice(0, 7)}-01`, to: to ?? (from ? monthEnd(from) : monthEnd(today)) };
  if (period.from > period.to) throw new PosError("bad_range");
  return period;
}

/** `EST-Op2-202610`: statement number of a store and period (the month of `from`). */
export const statementNumber = (storeCode: string, from: string): string => `EST-${storeCode}-${from.slice(0, 4)}${from.slice(5, 7)}`;

export interface RawSale {
  id: string;
  number: string;
  establishment_id: string;
  seller_code: string | null;
  seller_id: string | null;
  customer_id: string | null;
  status: string;
  delivery: string | null;
  created_at: string | Date;
  list_cents: number | string | null;
  discount_cents: number | string | null;
  total_cents: number | string;
  paid_cents: number | string | null;
  insurance_cents: number | string | null;
  balance_cents: number | string | null;
}

export interface RawPayment {
  sale_id: string;
  method_code: string;
  amount_cents: number | string;
  kind: string | null;
  reference: string | null;
  created_at: string | Date;
}

export interface RawFact {
  sale_id: string | null;
  line_item_id: string;
  title: string | null;
  brand: string | null;
  category: string;
  lens_design: string | null;
  lens_material: string | null;
  lens_photo: string | null;
  lens_ar: string | null;
  qty: number | string;
  list_cents: number | string;
  tax_cents: number | string | null;
  frame_cents: number | string | null;
  lenses_cents: number | string | null;
}

export interface StatementInput {
  sales: RawSale[];
  payments: RawPayment[];
  facts: RawFact[];
  /** order_line_item.id → variant title (the colour). */
  variants: Map<string, string | null>;
  /** customer.id → display name. */
  customers: Map<string, string>;
  /** establishment.id → store code. */
  storeCodes: Map<string, string>;
  methods: Array<{ code: string; label: string | null; label_en: string | null; builtin: boolean }>;
  tz: string;
}

const n = (v: unknown): number => Math.round(Number(v ?? 0)) || 0;
const iso = (v: string | Date): string => new Date(v).toISOString();

export function methodLabel(m: { label: string | null; label_en: string | null; builtin: boolean } | undefined): { es: string; en: string } | null {
  if (!m || m.builtin || !(m.label || m.label_en)) return null;
  return { es: String(m.label ?? m.label_en), en: String(m.label_en ?? m.label) };
}

/** The sales of the statement, lines and payments attached, oldest first. Pure. */
export function buildSales(input: StatementInput): StatementSale[] {
  const methods = new Map(input.methods.map((m) => [m.code, m]));
  const factsBySale = new Map<string, RawFact[]>();
  for (const f of input.facts) {
    if (!f.sale_id) continue;
    const list = factsBySale.get(f.sale_id) ?? [];
    list.push(f);
    factsBySale.set(f.sale_id, list);
  }
  const paymentsBySale = new Map<string, RawPayment[]>();
  for (const p of input.payments) {
    const list = paymentsBySale.get(p.sale_id) ?? [];
    list.push(p);
    paymentsBySale.set(p.sale_id, list);
  }
  return [...input.sales]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.number.localeCompare(b.number))
    .map((s) => {
      const facts = factsBySale.get(s.id) ?? [];
      const items: StatementItem[] = facts.map((f) => {
        const own = f.category === "own_frame";
        const withLenses = Boolean(f.lens_design) && f.lens_design !== "frame-only";
        return {
          title: own ? "" : String(f.title ?? ""),
          brand: own ? null : f.brand,
          variant: own ? null : input.variants.get(f.line_item_id) ?? null,
          kind: f.category,
          qty: Math.max(1, n(f.qty)),
          frame_cents: n(f.frame_cents),
          lens_cents: n(f.lenses_cents),
          list_cents: n(f.list_cents),
          lens: withLenses ? { design: f.lens_design, material: f.lens_material ?? null, photo: f.lens_photo ?? null, ar: f.lens_ar ?? null } : null,
        };
      });
      const payments: StatementPayment[] = (paymentsBySale.get(s.id) ?? [])
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((p) => ({
          method_code: p.method_code,
          method: methodLabel(methods.get(p.method_code)),
          kind: String(p.kind ?? "deposit"),
          amount_cents: n(p.amount_cents),
          reference: p.reference ?? null,
          at: iso(p.created_at),
        }));
      const total = n(s.total_cents);
      return {
        id: s.id,
        number: s.number,
        store_code: input.storeCodes.get(s.establishment_id) ?? s.number.split("-")[0],
        date: iso(s.created_at),
        day: localParts(new Date(s.created_at), input.tz).date,
        seller_code: s.seller_code ?? null,
        customer_name: (s.customer_id && input.customers.get(s.customer_id)) || null,
        delivery: String(s.delivery ?? "pickup"),
        status: s.status,
        items,
        list_cents: s.list_cents == null ? total : n(s.list_cents),
        discount_cents: n(s.discount_cents),
        tax_cents: facts.reduce((sum, f) => sum + n(f.tax_cents), 0),
        total_cents: total,
        paid_cents: n(s.paid_cents),
        insurance_cents: n(s.insurance_cents),
        balance_cents: n(s.balance_cents),
        payments,
      };
    });
}

/**
 * Period totals over completed sales; voided ones only count in
 * `voided_count`. Pure.
 *
 * Identities the statement must satisfy (tests/accounting-reconciliation.test.ts
 * pins them, docs/CONTABILIDAD.md explains them):
 *   Σ by_seller.total_cents = Σ by_day.total_cents = total_cents
 *   Σ by_method.cents       = paid_cents + insurance_cents
 *   balance_cents           = total_cents − paid_cents − insurance_cents
 *
 * `by_method` carries the insurer's part because it is a method like any
 * other at the counter, while `paid_cents` is only the customer's money —
 * that is why the second identity adds `insurance_cents` and is NOT a bug.
 */
export function statementTotals(sales: StatementSale[]): StatementTotals {
  const live = sales.filter((s) => s.status !== "voided");
  const sum = (k: "list_cents" | "discount_cents" | "tax_cents" | "total_cents" | "paid_cents" | "insurance_cents" | "balance_cents") => live.reduce((a, s) => a + s[k], 0);

  const byMethod = new Map<string, { code: string; label: { es: string; en: string } | null; cents: number }>();
  const bySeller = new Map<string, { seller_code: string | null; count: number; total_cents: number }>();
  const byDay = new Map<string, { date: string; count: number; total_cents: number }>();
  for (const s of live) {
    // What the till actually received: deposits and balances, less refunds. Insurance is a method like any other.
    for (const p of s.payments) {
      const row = byMethod.get(p.method_code) ?? { code: p.method_code, label: p.method, cents: 0 };
      row.cents += p.kind === "refund" ? -p.amount_cents : p.amount_cents;
      byMethod.set(p.method_code, row);
    }
    const sk = s.seller_code ?? "";
    const seller = bySeller.get(sk) ?? { seller_code: s.seller_code, count: 0, total_cents: 0 };
    seller.count += 1;
    seller.total_cents += s.total_cents;
    bySeller.set(sk, seller);
    const day = byDay.get(s.day) ?? { date: s.day, count: 0, total_cents: 0 };
    day.count += 1;
    day.total_cents += s.total_cents;
    byDay.set(s.day, day);
  }
  return {
    count: live.length,
    voided_count: sales.length - live.length,
    list_cents: sum("list_cents"),
    discount_cents: sum("discount_cents"),
    tax_cents: sum("tax_cents"),
    total_cents: sum("total_cents"),
    paid_cents: sum("paid_cents"),
    insurance_cents: sum("insurance_cents"),
    balance_cents: sum("balance_cents"),
    by_method: [...byMethod.values()].sort((a, b) => b.cents - a.cents || a.code.localeCompare(b.code)),
    by_seller: [...bySeller.values()].sort((a, b) => b.total_cents - a.total_cents || String(a.seller_code).localeCompare(String(b.seller_code))),
    by_day: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * The store's share of the period: `settlement_pct` of the net sales (total −
 * tax) of completed sales, for family, partner and consignment stores with a
 * percentage set. Null for own stores or without a percentage. Pure.
 */
export function settlementFor(store: { kind: string; settlement_pct: number | null }, totals: Pick<StatementTotals, "total_cents" | "tax_cents">): Settlement | null {
  if (store.kind === "own" || store.kind === "all" || store.settlement_pct == null || !Number.isFinite(store.settlement_pct)) return null;
  const base = totals.total_cents - totals.tax_cents;
  return { pct: store.settlement_pct, base_cents: base, amount_cents: Math.round((base * store.settlement_pct) / 100) };
}

// ── Loading ──────────────────────────────────────────────────────────────────

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

export interface StatementScope {
  /** Stores of the statement (one, or every active one for `all`). */
  stores: EstablishmentRow[];
  /** `all`: the business-wide statement an admin asked for. */
  all: boolean;
  /** Only this seller's sales (the seller role sees its own). */
  sellerId: string | null;
}

/** Store block of an `all` statement: the business itself. */
export const ALL_STORE: StatementStore = { code: "ALL", name: "", address: null, phone: null, kind: "all", settlement_pct: null, receipt_note: null };

export async function loadStatement(container: MedusaContainer, scope: StatementScope, period: { from: string; to: string }): Promise<Statement> {
  const pg = pgOf(container);
  const t = tenant();
  const ids = scope.stores.map((s) => s.id);
  const salesQ = pg("pos_sale as s")
    .whereNull("s.deleted_at")
    .whereIn("s.establishment_id", ids.length ? ids : ["-"])
    .whereRaw("(s.created_at AT TIME ZONE ?)::date BETWEEN ?::date AND ?::date", [t.timezone, period.from, period.to])
    .select(
      "s.id", "s.number", "s.establishment_id", "s.seller_code", "s.seller_id", "s.customer_id", "s.status", "s.delivery", "s.created_at",
      "s.list_cents", "s.discount_cents", "s.total_cents", "s.paid_cents", "s.insurance_cents", "s.balance_cents"
    )
    .orderBy("s.created_at", "asc")
    .limit(MAX_STATEMENT_SALES + 1);
  if (scope.sellerId) salesQ.where("s.seller_id", scope.sellerId);
  const rows = (await salesQ) as RawSale[];
  const truncated = rows.length > MAX_STATEMENT_SALES;
  const sales = truncated ? rows.slice(0, MAX_STATEMENT_SALES) : rows;
  const saleIds = sales.map((s) => s.id);
  const customerIds = [...new Set(sales.map((s) => s.customer_id).filter((v): v is string => Boolean(v)))];

  type CustomerRow = { id: string; first_name: string | null; last_name: string | null; email: string | null };
  const none = <T>(): Promise<T[]> => Promise.resolve([]);
  const [payments, facts, customerRows, methods] = await Promise.all([
    saleIds.length
      ? (pg("pos_sale_payment").whereNull("deleted_at").whereIn("sale_id", saleIds).select("sale_id", "method_code", "amount_cents", "kind", "reference", "created_at") as Promise<RawPayment[]>)
      : none<RawPayment>(),
    saleIds.length
      ? (pg("sale_fact").whereNull("deleted_at").whereIn("sale_id", saleIds).select(
          "sale_id", "line_item_id", "title", "brand", "category", "lens_design", "lens_material", "lens_photo", "lens_ar", "qty", "list_cents", "tax_cents", "frame_cents", "lenses_cents"
        ) as Promise<RawFact[]>)
      : none<RawFact>(),
    customerIds.length ? (pg("customer").whereIn("id", customerIds).select("id", "first_name", "last_name", "email") as Promise<CustomerRow[]>) : none<CustomerRow>(),
    listPaymentMethods(container),
  ]);

  const lineIds = [...new Set(facts.map((f) => f.line_item_id).filter(Boolean))];
  const variantRows = lineIds.length
    ? ((await pg("order_line_item").whereIn("id", lineIds).select("id", "variant_title")) as Array<{ id: string; variant_title: string | null }>)
    : [];

  const built = buildSales({
    sales,
    payments,
    facts,
    variants: new Map(variantRows.map((r) => [r.id, r.variant_title ?? null])),
    customers: new Map(customerRows.map((c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email || ""])),
    storeCodes: new Map(scope.stores.map((s) => [s.id, s.code])),
    methods,
    tz: t.timezone,
  });
  const totals = statementTotals(built);
  const one = scope.stores[0];
  const store: StatementStore =
    scope.all || !one
      ? { ...ALL_STORE, name: t.name }
      : { code: one.code, name: one.name, address: one.address, phone: one.phone, kind: one.kind, settlement_pct: one.settlement_pct, receipt_note: one.receipt_note };
  return {
    number: statementNumber(store.code, period.from),
    store,
    business: { name: t.name, legal_name: t.legalName, address: process.env.TENANT_ADDRESS?.trim() || null, url: t.storefrontUrl },
    period,
    generated_at: new Date().toISOString(),
    sales: built,
    totals,
    // A seller's own statement never carries the store's settlement.
    settlement: scope.sellerId ? null : settlementFor(store, totals),
    truncated,
  };
}
