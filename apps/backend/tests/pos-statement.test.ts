import { PosError } from "../src/lib/pos-data";
import {
  buildSales,
  methodLabel,
  monthEnd,
  periodFromQuery,
  settlementFor,
  statementNumber,
  statementTotals,
  type RawFact,
  type RawPayment,
  type RawSale,
  type StatementInput,
} from "../src/lib/pos-statement";

const TZ = "America/Chicago";

const sale = (o: Partial<RawSale>): RawSale => ({
  id: "poss_1",
  number: "Op2-000001",
  establishment_id: "est_2",
  seller_code: "ANA",
  seller_id: "user_ana",
  customer_id: "cus_1",
  status: "completed",
  delivery: "pickup",
  created_at: "2026-10-05T15:00:00Z",
  list_cents: 30000,
  discount_cents: 3000,
  total_cents: 27000,
  paid_cents: 10000,
  insurance_cents: 0,
  balance_cents: 17000,
  ...o,
});
const payment = (o: Partial<RawPayment>): RawPayment => ({ sale_id: "poss_1", method_code: "cash", amount_cents: 10000, kind: "deposit", reference: null, created_at: "2026-10-05T15:01:00Z", ...o });
const fact = (o: Partial<RawFact>): RawFact => ({
  sale_id: "poss_1",
  line_item_id: "oli_1",
  title: "DC407",
  brand: "Di Caprio",
  category: "frame",
  lens_design: "sv",
  lens_material: "poly",
  lens_photo: null,
  lens_ar: "ar-blue",
  qty: 1,
  list_cents: 30000,
  tax_cents: 0,
  frame_cents: 12000,
  lenses_cents: 15000,
  ...o,
});

const input = (o: Partial<StatementInput> = {}): StatementInput => ({
  sales: [
    sale({}),
    sale({ id: "poss_2", number: "Op2-000002", created_at: "2026-10-05T03:30:00Z", seller_code: "LUIS", seller_id: "user_luis", customer_id: null, list_cents: 10000, discount_cents: 0, total_cents: 10000, paid_cents: 10000, balance_cents: 0 }),
    sale({ id: "poss_3", number: "Op2-000003", created_at: "2026-10-20T18:00:00Z", status: "voided", total_cents: 50000, paid_cents: 0, balance_cents: 0 }),
  ],
  payments: [
    payment({}),
    payment({ sale_id: "poss_1", method_code: "zelle", amount_cents: 5000, kind: "balance", reference: "Z123", created_at: "2026-10-12T10:00:00Z" }),
    payment({ sale_id: "poss_2", method_code: "credit", amount_cents: 10000 }),
    payment({ sale_id: "poss_2", method_code: "credit", amount_cents: 2000, kind: "refund" }),
    payment({ sale_id: "poss_3", method_code: "cash", amount_cents: 50000 }),
  ],
  facts: [
    fact({}),
    fact({ sale_id: "poss_1", line_item_id: "oli_1b", title: "Estuche", brand: null, category: "case", lens_design: null, lens_ar: null, list_cents: 1500, frame_cents: 0, lenses_cents: 0 }),
    fact({ sale_id: "poss_2", line_item_id: "oli_2", title: "own_frame", brand: null, category: "own_frame", lens_design: "sv", list_cents: 10000, tax_cents: 800 }),
    fact({ sale_id: null, line_item_id: "oli_web", title: "web" }),
  ],
  variants: new Map([["oli_1", "Negro"], ["oli_2", "ignored for own frames"]]),
  customers: new Map([["cus_1", "María Pérez"]]),
  storeCodes: new Map([["est_2", "Op2"]]),
  methods: [
    { code: "cash", label: null, label_en: null, builtin: true },
    { code: "zelle", label: null, label_en: null, builtin: true },
    { code: "credit", label: null, label_en: null, builtin: true },
    { code: "afterpay", label: "Afterpay (cuotas)", label_en: "Afterpay", builtin: false },
  ],
  tz: TZ,
  ...o,
});

describe("periodFromQuery", () => {
  it("defaults to the whole current month", () => {
    expect(periodFromQuery({}, "2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodFromQuery({}, "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("completes a half-open range with the month", () => {
    expect(periodFromQuery({ from: "2026-09-15" }, "2026-10-31")).toEqual({ from: "2026-09-15", to: "2026-09-30" });
    expect(periodFromQuery({ to: "2026-09-15" }, "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-15" });
    expect(periodFromQuery({ from: "2026-09-01", to: "2026-10-31" }, "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-10-31" });
  });
  it("rejects a malformed or inverted range with a reason", () => {
    expect(() => periodFromQuery({ from: "10/01/2026" }, "2026-10-31")).toThrow(PosError);
    expect(() => periodFromQuery({ from: "2026-10-31", to: "2026-10-01" }, "2026-10-31")).toThrow(expect.objectContaining({ reason: "bad_range" }));
  });
  it("month end and statement number", () => {
    expect(monthEnd("2024-02-10")).toBe("2024-02-29");
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
    expect(statementNumber("Op2", "2026-10-01")).toBe("EST-Op2-202610");
  });
});

describe("buildSales", () => {
  const sales = buildSales(input());

  it("orders by date, attaches lines, payments and the customer", () => {
    expect(sales.map((s) => s.number)).toEqual(["Op2-000002", "Op2-000001", "Op2-000003"]);
    const s1 = sales[1];
    expect(s1.customer_name).toBe("María Pérez");
    expect(s1.store_code).toBe("Op2");
    expect(s1.items).toHaveLength(2);
    expect(s1.items[0]).toMatchObject({ title: "DC407", brand: "Di Caprio", variant: "Negro", kind: "frame", qty: 1, frame_cents: 12000, lens_cents: 15000, list_cents: 30000 });
    expect(s1.items[0].lens).toEqual({ design: "sv", material: "poly", photo: null, ar: "ar-blue" });
    expect(s1.items[1]).toMatchObject({ kind: "case", lens: null });
    expect(s1.payments.map((p) => [p.method_code, p.kind, p.amount_cents, p.reference])).toEqual([["cash", "deposit", 10000, null], ["zelle", "balance", 5000, "Z123"]]);
    expect(s1.payments[0].method).toBeNull();
    expect(s1).toMatchObject({ list_cents: 30000, discount_cents: 3000, tax_cents: 0, total_cents: 27000, paid_cents: 10000, balance_cents: 17000 });
  });

  it("puts the sale on its local calendar day", () => {
    // 03:30Z on the 5th is still the 4th in Chicago.
    expect(sales[0].day).toBe("2026-10-04");
    expect(sales[1].day).toBe("2026-10-05");
  });

  it("an own frame has no title, brand or variant; its tax adds up", () => {
    const s2 = sales[0];
    expect(s2.items[0]).toMatchObject({ kind: "own_frame", title: "", brand: null, variant: null });
    expect(s2.tax_cents).toBe(800);
    expect(s2.customer_name).toBeNull();
  });

  it("falls back to the total when there is no list price", () => {
    const [s] = buildSales(input({ sales: [sale({ list_cents: null })], payments: [], facts: [] }));
    expect(s.list_cents).toBe(27000);
    expect(s.items).toEqual([]);
  });

  it("names an owner-added method in both languages", () => {
    expect(methodLabel({ label: "Afterpay (cuotas)", label_en: "Afterpay", builtin: false })).toEqual({ es: "Afterpay (cuotas)", en: "Afterpay" });
    expect(methodLabel({ label: "Plan", label_en: null, builtin: false })).toEqual({ es: "Plan", en: "Plan" });
    expect(methodLabel({ label: "x", label_en: "x", builtin: true })).toBeNull();
    expect(methodLabel(undefined)).toBeNull();
  });
});

describe("statementTotals", () => {
  const totals = statementTotals(buildSales(input()));

  it("excludes voided sales from every total but voided_count", () => {
    expect(totals.count).toBe(2);
    expect(totals.voided_count).toBe(1);
    expect(totals).toMatchObject({ list_cents: 40000, discount_cents: 3000, tax_cents: 800, total_cents: 37000, paid_cents: 20000, insurance_cents: 0, balance_cents: 17000 });
  });

  it("groups collections by method net of refunds, biggest first", () => {
    expect(totals.by_method).toEqual([
      { code: "cash", label: null, cents: 10000 },
      { code: "credit", label: null, cents: 8000 },
      { code: "zelle", label: null, cents: 5000 },
    ]);
  });

  it("groups by seller and by day", () => {
    expect(totals.by_seller).toEqual([
      { seller_code: "ANA", count: 1, total_cents: 27000 },
      { seller_code: "LUIS", count: 1, total_cents: 10000 },
    ]);
    expect(totals.by_day).toEqual([
      { date: "2026-10-04", count: 1, total_cents: 10000 },
      { date: "2026-10-05", count: 1, total_cents: 27000 },
    ]);
  });

  it("is all zeros for an empty period", () => {
    const empty = statementTotals([]);
    expect(empty).toMatchObject({ count: 0, voided_count: 0, total_cents: 0, by_method: [], by_seller: [], by_day: [] });
  });
});

describe("settlementFor", () => {
  const totals = { total_cents: 37000, tax_cents: 800 };
  it("applies the percentage to the net sales of a partner store", () => {
    expect(settlementFor({ kind: "family", settlement_pct: 30 }, totals)).toEqual({ pct: 30, base_cents: 36200, amount_cents: 10860 });
    expect(settlementFor({ kind: "consignment", settlement_pct: 12.5 }, totals)).toEqual({ pct: 12.5, base_cents: 36200, amount_cents: 4525 });
  });
  it("is null for own stores, the whole business or without a percentage", () => {
    expect(settlementFor({ kind: "own", settlement_pct: 30 }, totals)).toBeNull();
    expect(settlementFor({ kind: "all", settlement_pct: null }, totals)).toBeNull();
    expect(settlementFor({ kind: "partner", settlement_pct: null }, totals)).toBeNull();
  });
});
