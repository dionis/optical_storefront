import { commissionResolverOf, resolveCommissionPct } from "../src/lib/commission-pct";
import type { CostRule } from "../src/lib/costing";
import {
  buildStatement,
  bucketSum,
  ledgerOf,
  monthsBetween,
  periodKeyOf,
  statementDollars,
  statementOf,
  TAX_LINES,
  OPEX_CATEGORIES,
  WEB_ENTITY,
  type LedgerFact,
  type LedgerInput,
  type LedgerItem,
} from "../src/lib/financial-statement";
import { lineEconomics, type InsightLine } from "../src/lib/sales-insights";
import { cleanCostItem, computePnl, monthlyCharge, normalizedMonthly, perSaleCharge, spreadCents, taxCategoryOf, TAX_CATEGORIES, type CostItemLike } from "../src/lib/store-costs";
import { planRulesImport, type ImportContext, type StoredCostItem } from "../src/lib/store-costs-import";

/**
 * «Reglas y comisiones» + the financial statement (7-nov-2026):
 *  - the monthly normalisation of every frequency, exact over a whole cycle;
 *  - the statement's identities: revenue − COGS − opex − fees − commissions =
 *    net income; each store's column = its store result (computePnl over the
 *    same ledger); the material cost, fees, commissions and «ganancia» = the
 *    Executive's (lineEconomics) on the same lines;
 *  - the default commission is applied when a seller has no own %;
 *  - the import plan.
 */

// ── 1. Normalisation by frequency ────────────────────────────────────────────

const item = (o: Partial<CostItemLike>): CostItemLike => ({
  establishment_id: "est_1",
  kind: "fixed",
  amount_cents: 100000,
  frequency: "monthly",
  amortize_months: null,
  starts_on: "2026-01-01",
  ends_on: null,
  allocation: null,
  ...o,
});
const YEAR = monthsBetween("2026-01-01", "2026-12-31");
const yearOf = (it: CostItemLike) => YEAR.reduce((s, m) => s + monthlyCharge(it, m), 0);

describe("frequency normalisation (monthly equivalents)", () => {
  it("daily × 365/12, weekly × 52/12, biweekly × 26/12, quarterly ÷ 3, annual ÷ 12", () => {
    expect(normalizedMonthly(item({ frequency: "daily", amount_cents: 1000 }))).toBe(30417); // $10/day → $304.17/month (30.4167 days)
    expect(normalizedMonthly(item({ frequency: "weekly", amount_cents: 12000 }))).toBe(52000); // $120/week → $520
    expect(normalizedMonthly(item({ frequency: "biweekly", amount_cents: 120000 }))).toBe(260000); // $1,200 every 2 weeks → $2,600
    expect(normalizedMonthly(item({ frequency: "monthly" }))).toBe(100000);
    expect(normalizedMonthly(item({ frequency: "quarterly", amount_cents: 30000 }))).toBe(10000);
    expect(normalizedMonthly(item({ frequency: "annual", amount_cents: 120000 }))).toBe(10000);
    expect(normalizedMonthly(item({ frequency: "one_time", amount_cents: 120000, amortize_months: 12 }))).toBe(10000);
    expect(normalizedMonthly(item({ per_sale: true, amount_cents: 150 }), 40)).toBe(6000);
  });

  it("a whole year adds up EXACTLY to what the frequency says (running round, never 12 × a rounded month)", () => {
    expect(yearOf(item({ frequency: "annual", amount_cents: 100000 }))).toBe(100000); // 1,000.00 / 12 = 83.33… each
    expect(yearOf(item({ frequency: "quarterly", amount_cents: 100000 }))).toBe(400000);
    expect(yearOf(item({ frequency: "daily", amount_cents: 1001 }))).toBe(1001 * 365);
    expect(yearOf(item({ frequency: "weekly", amount_cents: 3333 }))).toBe(3333 * 52);
    expect(yearOf(item({ frequency: "biweekly", amount_cents: 77777 }))).toBe(77777 * 26);
    expect(yearOf(item({ frequency: "monthly", amount_cents: 2599 }))).toBe(2599 * 12);
    // a one-time item in its month, or spread over its months and then nothing
    expect(yearOf(item({ frequency: "one_time", amount_cents: 100001, starts_on: "2026-03-10" }))).toBe(100001);
    expect(monthlyCharge(item({ frequency: "one_time", amount_cents: 100001, starts_on: "2026-03-10" }), "2026-03")).toBe(100001);
    expect(yearOf(item({ frequency: "one_time", amount_cents: 100000, amortize_months: 7 }))).toBe(100000);
    expect(spreadCents(100000, 1, 12, 0) + spreadCents(100000, 1, 12, 1)).toBe(16667);
  });

  it("an inactive item, a per-sale item and an item out of its validity charge nothing by time", () => {
    expect(monthlyCharge(item({ active: false }), "2026-05")).toBe(0);
    expect(monthlyCharge(item({ per_sale: true }), "2026-05")).toBe(0);
    expect(monthlyCharge(item({ ends_on: "2026-04-30" }), "2026-05")).toBe(0);
    expect(perSaleCharge(item({ per_sale: true, amount_cents: 125 }), "2026-05", 9)).toBe(1125);
    expect(perSaleCharge(item({ per_sale: true, amount_cents: 125, active: false }), "2026-05", 9)).toBe(0);
    expect(perSaleCharge(item({ per_sale: true, amount_cents: 125, starts_on: "2026-06-01" }), "2026-05", 9)).toBe(0);
  });

  it("the tax bucket: own, or mapped from the category; cleanCostItem takes the new fields", () => {
    expect(taxCategoryOf({ category: "remakes" })).toBe("cost_of_goods");
    expect(taxCategoryOf({ category: "equipment" })).toBe("depreciation");
    expect(taxCategoryOf({ category: "rent", tax_category: "other" })).toBe("other");
    expect(taxCategoryOf({ category: "nope" })).toBe("other");
    const ok = cleanCostItem({ establishment_id: "est_1", kind: "variable", tax_category: "advertising", amount: 12.5, frequency: "weekly", starts_on: "2026-01-01", per_sale: "true", active: false }, ["est_1"]);
    expect("item" in ok && ok.item).toMatchObject({ category: "other", tax_category: "advertising", frequency: "weekly", per_sale: true, active: false, amount_cents: 1250 });
    expect(cleanCostItem({ establishment_id: "est_1", kind: "fixed", tax_category: "bribes", amount: 1, starts_on: "2026-01-01" }, ["est_1"])).toEqual({ reason: "bad_tax_category" });
    expect(cleanCostItem({ establishment_id: "est_1", kind: "fixed", category: "rent", amount: 1, frequency: "hourly", starts_on: "2026-01-01" }, ["est_1"])).toEqual({ reason: "bad_frequency" });
  });

  it("every tax bucket has a Schedule C and a 1120-S line", () => {
    for (const c of TAX_CATEGORIES) expect(TAX_LINES[c]).toBeDefined();
    for (const k of ["revenue", "cogs", "gross_profit", "card_fees", "commissions", "opex", "net_income"]) expect(TAX_LINES[k]).toBeDefined();
  });
});

describe("periods", () => {
  it("months, quarters and years", () => {
    expect(monthsBetween("2026-11-15", "2027-02-03")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(periodKeyOf("2026-11", "quarter")).toBe("2026-Q4");
    expect(periodKeyOf("2026-01", "quarter")).toBe("2026-Q1");
    expect(periodKeyOf("2026-11", "year")).toBe("2026");
  });
});

// ── 2. The ledger and the statement ──────────────────────────────────────────

const rule = (kind: CostRule["kind"], match_key: string, amount: number, unit: CostRule["unit"] = "fixed"): CostRule => ({ kind, match_key, label: match_key, amount, unit, active: true, sort_order: 0 });
const RULES = [
  rule("frame_brand", "flexure", 20),
  rule("lens_design", "sv", 10),
  rule("lens_ar", "ar1", 4),
  rule("order_fixed", "lab", 1),
  rule("order_percent", "payment_fee", 2.9, "percent"),
  rule("payment_fixed", "payment_fee_fixed", 0.3),
  rule("order_percent", "profit_target", 30, "percent"),
  rule("order_percent", "marketing", 3, "percent"),
];

const fact = (o: Partial<LedgerFact>): LedgerFact => ({
  order_id: "o1",
  channel: "pos",
  establishment_id: "est_1",
  seller_id: "u_ana",
  seller_code: "ANA",
  product_id: "p1",
  sku: "FX1",
  qty: 1,
  total_cents: 15000,
  tax_cents: 0,
  lens_design: "sv",
  lens_material: null,
  lens_photo: null,
  lens_ar: null,
  lens_finish: null,
  sold_date_local: "2026-10-05",
  ...o,
});

// October and November 2026; two stores; one web order with a referral code.
const FACTS: LedgerFact[] = [
  fact({}),
  fact({ order_id: "o2", sku: "FX2", lens_design: null, total_cents: 10700, tax_cents: 700, sold_date_local: "2026-10-06" }),
  fact({ order_id: "o3", seller_id: "u_new", seller_code: null, lens_ar: "ar1", total_cents: 20000, sold_date_local: "2026-10-20" }), // a user with NO % anywhere → default
  fact({ order_id: "o4", establishment_id: "est_2", seller_id: "u_bob", seller_code: "BOB", total_cents: 9000, sold_date_local: "2026-10-21" }),
  fact({ order_id: "o5", sku: "FX3", total_cents: 7000, sold_date_local: "2026-11-02" }),
  // a two-line web order: frame + lens, referral CARLOS
  fact({ order_id: "w1", channel: "web", establishment_id: null, seller_id: null, seller_code: "CARLOS", total_cents: 8000, lens_design: null, sold_date_local: "2026-10-09" }),
  fact({ order_id: "w1", channel: "web", establishment_id: null, seller_id: null, seller_code: "CARLOS", product_id: null, sku: null, total_cents: 6000, sold_date_local: "2026-10-09" }),
];

const PAYS = [
  { establishment_id: "est_1", fee_cents: 0, created_at: "2026-10-05T15:00:00Z", sale_status: "completed" },
  { establishment_id: "est_1", fee_cents: 340, created_at: "2026-10-06T15:00:00Z", sale_status: "completed" },
  { establishment_id: "est_1", fee_cents: 610, created_at: "2026-10-20T15:00:00Z", sale_status: "completed" },
  { establishment_id: "est_1", fee_cents: 500, created_at: "2026-10-22T15:00:00Z", sale_status: "voided" }, // out
  { establishment_id: "est_2", fee_cents: 291, created_at: "2026-10-21T15:00:00Z", sale_status: "completed" },
  { establishment_id: "est_1", fee_cents: 233, created_at: "2026-11-02T15:00:00Z", sale_status: "completed" },
];

const litem = (o: Partial<LedgerItem>): LedgerItem => ({ id: "c", establishment_id: "est_1", kind: "fixed", amount_cents: 0, frequency: "monthly", amortize_months: null, starts_on: "2026-01-01", ends_on: null, allocation: null, category: "rent", ...o });
const ITEMS: LedgerItem[] = [
  litem({ id: "rent1", amount_cents: 250000, category: "rent" }),
  litem({ id: "light2", establishment_id: "est_2", kind: "variable", amount_cents: 18000, category: "utilities" }),
  litem({ id: "soft", establishment_id: null, amount_cents: 30001, category: "subscriptions", allocation: { method: "sales" } }),
  litem({ id: "payroll1", amount_cents: 60000, frequency: "biweekly", category: "salaries" }),
  litem({ id: "bag", establishment_id: null, kind: "variable", amount_cents: 75, per_sale: true, category: "supplies" }),
  litem({ id: "remake", kind: "variable", amount_cents: 4500, frequency: "one_time", starts_on: "2026-10-12", category: "remakes" }),
  litem({ id: "ads", amount_cents: 12000, frequency: "weekly", tax_category: "advertising", category: "other" }),
  litem({ id: "off", amount_cents: 99900, active: false }),
];

const PROFILES = new Map<string, { commission_pct: number | null }>([["u_ana", { commission_pct: 10 }], ["u_new", { commission_pct: null }], ["u_bob", { commission_pct: null }]]);
const SELLERS = new Map([["BOB", { commission_pct: 8 }], ["CARLOS", { commission_pct: 5 }]]);
const DEFAULT_PCT = 7;
const pctOf = commissionResolverOf(PROFILES, SELLERS, DEFAULT_PCT);

const input = (o: Partial<LedgerInput> = {}): LedgerInput => ({
  months: ["2026-10", "2026-11"],
  facts: FACTS,
  pays: PAYS,
  rules: RULES,
  items: ITEMS,
  brandOf: (id) => (id ? "flexure" : null),
  pctOf,
  storeIds: ["est_1", "est_2"],
  activeStoreIds: ["est_1", "est_2"],
  tz: "UTC",
  web: true,
  ...o,
});

/** The same lines as Ejecutivo reads them (InsightLine) with its own context. */
function executive(facts: LedgerFact[], month: string, saleFees: Map<string, number>) {
  const lines: InsightLine[] = facts
    .filter((f) => f.sold_date_local.startsWith(month))
    .map((f) => ({ ...f, sale_id: f.channel === "pos" ? `s_${f.order_id}` : null, terminal_id: null, title: null, brand: null, brand_slug: f.product_id ? "flexure" : null, category: f.product_id ? "frame" : "own_frame", payment_methods: null, hour: 12 }));
  const orders = new Map<string, { gross: number; net: number; lines: number }>();
  for (const l of lines) {
    const o = orders.get(l.order_id) ?? { gross: 0, net: 0, lines: 0 };
    o.gross += l.total_cents;
    o.net += l.total_cents - l.tax_cents;
    o.lines += 1;
    orders.set(l.order_id, o);
  }
  const econ = lineEconomics(lines, { rules: RULES, orders, saleFees, commissionPct: pctOf });
  const sum = (k: "net" | "cost" | "fee" | "commission" | "profit") => econ.reduce((s, e) => s + e[k], 0);
  return { net: sum("net"), cost: sum("cost"), fee: sum("fee"), commission: sum("commission"), profit: sum("profit") };
}

describe("ledgerOf + statementOf: identities", () => {
  const ledger = ledgerOf(input());
  const oct = ledger[0];
  const s1 = oct.entities.get("est_1")!;

  it("revenue − COGS − opex (categories + card fees + commissions) = operating income = net income", () => {
    for (const lm of ledger) {
      for (const e of lm.entities.values()) {
        const s = statementOf([e]);
        const opexCats = OPEX_CATEGORIES.reduce((a, c) => a + s.opex[c], 0);
        expect(s.revenue.total - s.cogs.total_all - opexCats - s.opex.card_fees - s.opex.commissions).toBe(s.net_income);
        expect(s.gross_profit - s.opex.total).toBe(s.operating_income);
        expect(s.net_income).toBe(s.operating_income);
      }
    }
  });

  it("each store's column = its store result (computePnl over the same ledger), to the cent", () => {
    for (const lm of ledger) {
      for (const id of ["est_1", "est_2"]) {
        const e = lm.entities.get(id)!;
        const p = computePnl({ net_sales: e.net_sales, cogs: e.cogs.total, payment_fees: e.payment_fees, commissions: e.commissions, variable_manual: bucketSum(e, "variable"), fixed: bucketSum(e, "fixed"), shared: bucketSum(e, "shared") });
        const s = statementOf([e]);
        expect(s.net_income).toBe(p.result);
        expect(s.memo.contribution).toBe(p.contribution);
        expect(s.memo.fixed_total).toBe(p.fixed_total);
        expect(s.memo.break_even).toBe(p.break_even);
      }
    }
  });

  it("material cost, fees, commissions and «ganancia» = the Executive's on the same lines (store and web)", () => {
    const saleFees = new Map([["s_o1", 0], ["s_o2", 340], ["s_o3", 610], ["s_o4", 291], ["s_o5", 233]]);
    const ex = executive(FACTS, "2026-10", saleFees);
    const all = statementOf([...oct.entities.values()]);
    expect(all.revenue.total).toBe(ex.net);
    expect(all.cogs.total).toBe(ex.cost);
    expect(all.opex.card_fees).toBe(ex.fee);
    expect(all.opex.commissions).toBe(ex.commission);
    expect(all.memo.gross_contribution).toBe(ex.profit);
    // the web order: gateway 2.9 % of $140 + $0.30, once per ORDER (two lines)
    expect(oct.entities.get(WEB_ENTITY)!.payment_fees).toBe(Math.round((14000 * 2.9) / 100) + 30);
  });

  it("COGS split, sales tax as a liability, per-sale and inactive items, shared costs adding up", () => {
    // o1 frame 20 + lens 10 + lab 1; o2 frame 20 + lab 1; o3 frame 20 + lens 10 + AR 4 + lab 1
    expect(s1.cogs).toEqual({ frames: 6000, lenses: 2000, treatments: 400, per_order: 300, total: 8700 });
    const st = statementOf([s1]);
    expect(st.sales_tax).toBe(700);
    expect(st.revenue.total).toBe(15000 + 10000 + 20000); // tax never revenue
    expect(st.cogs.items).toBe(4500); // the remake: cost_of_goods bucket
    expect(st.opex.advertising).toBe(spreadCents(12000, 52, 12, 9)); // weekly, 10th month
    expect(st.opex.supplies).toBe(75 * 3); // per-sale bag × 3 sales of est_1
    expect(s1.costs.find((c) => c.item_id === "off")).toBeUndefined();
    const softParts = [...oct.entities.values()].flatMap((e) => e.costs.filter((c) => c.item_id === "soft")).reduce((a, c) => a + c.cents, 0);
    expect(softParts).toBe(30001);
    expect(oct.entities.get(WEB_ENTITY)!.costs).toEqual([]); // the web carries no store costs
    // the voided sale's fee is out
    expect(s1.payment_fees).toBe(950);
  });

  it("a period is the sum of its months; consolidated = Σ entities", () => {
    const doc = buildStatement(ledger, "quarter", [
      { id: "est_1", code: "Op1", name: "A", color: null, kind: "store" },
      { id: "est_2", code: "Op2", name: "B", color: null, kind: "store" },
      { id: WEB_ENTITY, code: "WEB", name: "Online", color: null, kind: "web" },
      { id: "total", code: "TOTAL", name: "Consolidated", color: null, kind: "total" },
    ]);
    expect(doc.periods).toEqual(["2026-Q4"]);
    const q = doc.statements["2026-Q4"];
    const parts = ["est_1", "est_2", WEB_ENTITY].map((id) => q[id].net_income).reduce((a, b) => a + b, 0);
    expect(q.total.net_income).toBe(parts);
    const months = ledger.map((lm) => statementOf([...lm.entities.values()]).net_income).reduce((a, b) => a + b, 0);
    expect(doc.statements.all.total.net_income).toBe(months);
    const d = statementDollars(q.total);
    expect(d.net_income).toBe(q.total.net_income / 100);
    expect(d.pct).toEqual(q.total.pct);
  });

  it("a narrower view keeps the share of a shared cost (weights from every active store)", () => {
    const whole = ledgerOf(input())[0];
    const netByMonthStore = new Map([["2026-10", new Map([["est_1", whole.entities.get("est_1")!.net_sales], ["est_2", whole.entities.get("est_2")!.net_sales]])]]);
    const one = ledgerOf(input({ months: ["2026-10"], storeIds: ["est_2"], web: false, netByMonthStore }))[0];
    const part = (lm: typeof whole) => lm.entities.get("est_2")!.costs.filter((c) => c.item_id === "soft").reduce((a, c) => a + c.cents, 0);
    expect(part(one)).toBe(part(whole));
  });
});

// ── 3. The default commission ───────────────────────────────────────────────

describe("default commission (single source)", () => {
  it("profile, then seller record, then the default — only when there is a seller", () => {
    expect(resolveCommissionPct(10, 8, true, 7)).toBe(10);
    expect(resolveCommissionPct(null, 8, true, 7)).toBe(8);
    expect(resolveCommissionPct(null, 0, true, 7)).toBe(0); // an explicit 0 on the record is the seller's own %
    expect(resolveCommissionPct(null, null, true, 7)).toBe(7);
    expect(resolveCommissionPct(null, null, false, 7)).toBeNull(); // nobody to pay
    expect(resolveCommissionPct(null, null, true, null)).toBeNull(); // the owner never set one
  });

  it("is applied in the ledger to a user with no % anywhere", () => {
    const oct = ledgerOf(input())[0];
    // o1 10 % of 150 = 15.00; o2 10 % of 100 = 10.00; o3 7 % (default) of 200 = 14.00
    expect(oct.entities.get("est_1")!.commissions).toBe(1500 + 1000 + 1400);
    // BOB's seller record 8 % of 90 = 7.20; CARLOS (web) 5 % of 80 + 60 = 4.00 + 3.00
    expect(oct.entities.get("est_2")!.commissions).toBe(720);
    expect(oct.entities.get(WEB_ENTITY)!.commissions).toBe(700);
    const noDefault = ledgerOf(input({ pctOf: commissionResolverOf(PROFILES, SELLERS, null) }))[0];
    expect(noDefault.entities.get("est_1")!.commissions).toBe(2500);
  });
});

// ── 4. The import plan ──────────────────────────────────────────────────────

describe("planRulesImport", () => {
  const stored: StoredCostItem = {
    id: "cst_1", establishment_id: "est_1", kind: "fixed", category: "rent", tax_category: "rent", description: "Renta", amount_cents: 250000,
    frequency: "monthly", amortize_months: null, starts_on: "2026-01-01", ends_on: null, vendor: null, notes: null, active: true, per_sale: false, allocation: null,
  };
  const ctx: ImportContext = {
    items: [stored],
    rules: [{ ...rule("order_fixed", "lab", 1), id: "r_lab" }],
    sellers: [{ id: "sel_1", code: "SOFIA", name: "Sofía", commission_pct: 8 }],
    defaultPct: 7,
    storeByCode: new Map([["Op1", "est_1"], ["Op2", "est_2"]]),
    writableStores: null,
  };

  it("unchanged rows are not changes; changed fields go before → after; new rows are creations", () => {
    const plan = planRulesImport({
      costs: [
        { row: 2, id: "cst_1", store: "Op1", kind: "fixed", category: "rent", tax_category: "rent", description: "Renta", amount: 2500, frequency: "monthly", starts_on: "2026-01-01", active: true, per_sale: false },
        { row: 3, id: "", store: "Op2", kind: "variable", tax_category: "supplies", description: "Bolsa", amount: 0.75, frequency: "monthly", starts_on: "2026-11-01", per_sale: true },
        { row: 4, id: "cst_1", store: "Op1", amount: 2600, frequency: "biweekly" },
      ],
      rules: [{ row: 2, id: "r_lab", kind: "order_fixed", match_key: "lab", label: "lab", amount: 1.5, active: true }],
      commissions: { default_pct: 7, sellers: [{ row: 2, code: "sofia", pct: 9 }] },
    }, ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.unchanged).toBe(2); // row 2 and the default
    expect(plan.counts).toMatchObject({ create: 1, update: 3 });
    const upd = plan.changes.find((c) => c.sheet === "costs" && c.op === "update")!;
    expect(upd.fields).toEqual({ amount_cents: [250000, 260000], frequency: ["monthly", "biweekly"] });
    expect(plan.writes.costCreates[0]).toMatchObject({ establishment_id: "est_2", per_sale: true, amount_cents: 75, category: "supplies" });
    expect(plan.writes.rules[0]).toMatchObject({ id: "r_lab", amount: 1.5 });
    expect(plan.writes.sellers).toEqual([{ id: "sel_1", pct: 9 }]);
  });

  it("errors: unknown store, unknown id, bad values, the profit target; nothing is deleted", () => {
    const plan = planRulesImport({
      costs: [
        { row: 5, store: "Op9", kind: "fixed", category: "rent", amount: 1, starts_on: "2026-01-01" },
        { row: 6, id: "cst_x", store: "Op1", kind: "fixed", category: "rent", amount: 1, starts_on: "2026-01-01" },
        { row: 7, store: "Op1", kind: "fixed", category: "rent", amount: -3, starts_on: "2026-01-01" },
      ],
      rules: [{ row: 3, kind: "order_percent", match_key: "profit_target", amount: 30 }, { row: 4, kind: "nope", match_key: "x", amount: 1 }],
      commissions: { default_pct: 140, sellers: [{ row: 3, code: "GHOST", pct: 5 }] },
    }, ctx);
    expect(plan.errors.map((e) => `${e.sheet}:${e.row}:${e.reason}`)).toEqual([
      "costs:5:bad_store", "costs:6:cost_not_found", "costs:7:bad_amount", "rules:3:not_a_cost", "rules:4:bad_kind", "commissions:null:commission_invalid", "commissions:3:seller_not_found",
    ]);
    expect(plan.writes.costCreates).toEqual([]);
  });

  it("a privileged manager can only touch their stores (and no shared cost)", () => {
    const plan = planRulesImport({ costs: [{ row: 2, store: "", kind: "fixed", category: "rent", amount: 1, starts_on: "2026-01-01" }, { row: 3, store: "Op2", kind: "fixed", category: "rent", amount: 1, starts_on: "2026-01-01" }] }, { ...ctx, writableStores: ["est_1"] });
    expect(plan.errors.map((e) => e.reason)).toEqual(["forbidden_store", "forbidden_store"]);
  });
});
