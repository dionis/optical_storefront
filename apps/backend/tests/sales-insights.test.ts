import type { CostRule } from "../src/lib/costing";
import { isAllowedForRestrictedRole } from "../src/lib/staff-roles";
import {
  bucketOf,
  bucketsOf,
  buildInsights,
  grainFor,
  isoWeekOf,
  keysOf,
  lineEconomics,
  redactInsights,
  weekStart,
  type EconomicsContext,
  type Figures,
  type InsightLine,
} from "../src/lib/sales-insights";

const rule = (kind: CostRule["kind"], match_key: string, amount: number, unit: CostRule["unit"] = "fixed"): CostRule => ({ kind, match_key, label: match_key, amount, unit, active: true, sort_order: 0 });
const RULES = [
  rule("frame_brand", "flexure", 20),
  rule("lens_design", "sv", 10),
  rule("order_fixed", "lab", 5),
  rule("order_percent", "payment_fee", 3, "percent"),
  rule("payment_fixed", "payment_fee_fixed", 0.3),
  rule("order_percent", "rent", 10, "percent"),
  rule("order_percent", "profit_target", 30, "percent"),
];

const line = (over: Partial<InsightLine> = {}): InsightLine => ({
  order_id: "o1",
  sale_id: "s1",
  channel: "pos",
  establishment_id: "est_1",
  terminal_id: "t1",
  seller_id: "u1",
  seller_code: "ANA",
  product_id: "p1",
  sku: "FX1",
  title: "Flex 1",
  brand: "Flexure",
  brand_slug: "flexure",
  category: "frame",
  lens_design: "sv",
  lens_material: null,
  lens_photo: null,
  lens_ar: null,
  payment_methods: ["cash"],
  qty: 1,
  total_cents: 10800,
  tax_cents: 800,
  sold_date_local: "2026-10-27",
  hour: 15,
  ...over,
});

const ctx = (over: Partial<EconomicsContext> = {}): EconomicsContext => ({
  rules: RULES,
  orders: new Map([["o1", { gross: 10800, net: 10000, lines: 1 }]]),
  saleFees: new Map([["s1", 250]]),
  saleCash: new Map([["s1", { paid: 8000, balance: 2800 }]]),
  commissionPct: () => 10,
  ...over,
});

const ZERO: Figures = { sales: 0, net: 0, tax: 0, cost: 0, fee: 0, commission: 0, profit: 0, margin_pct: null, paid: 0, balance: 0, count: 0, units: 0, avg_ticket: 0 };
const NO_LABELS = { store: () => null, sellerName: () => null };

describe("lineEconomics", () => {
  it("net minus materials, recorded fee and commission; rent and the target stay out", () => {
    const [e] = lineEconomics([line()], ctx());
    expect(e).toEqual({ net: 10000, cost: 3500, fee: 250, commission: 1000, profit: 5250, paid: 8000, balance: 2800, missing_cost: false });
  });

  it("a web order pays the gateway rules", () => {
    const l = line({ sale_id: null, channel: "web", seller_id: null, seller_code: null });
    const [e] = lineEconomics([l], ctx({ commissionPct: () => null }));
    expect(e.fee).toBe(354); // 3 % of 108.00 + 0.30
    expect(e.commission).toBe(0);
  });

  it("a filter that picks one line charges it only its share of the sale", () => {
    const orders = new Map([["o1", { gross: 21600, net: 20000, lines: 2 }]]);
    const [e] = lineEconomics([line()], ctx({ orders, saleFees: new Map([["s1", 400]]) }));
    expect(e.fee).toBe(200);
    expect(e.cost).toBe(3250); // frame + lens + half of the lab
  });

  it("flags a frame without a cost, but not the customer's own frame", () => {
    const noBrand = line({ brand_slug: "unknown" });
    const own = line({ category: "own_frame", sku: null, brand_slug: null, product_id: null });
    const [a, b] = lineEconomics([noBrand, own], ctx());
    expect(a.missing_cost).toBe(true);
    expect(b.missing_cost).toBe(false);
  });
});

describe("time buckets", () => {
  it("picks a grain that suits the range", () => {
    expect(grainFor("2026-10-27", "2026-10-27")).toBe("hour");
    expect(grainFor("2026-10-01", "2026-10-31")).toBe("day");
    expect(grainFor("2026-05-01", "2026-09-30")).toBe("week");
    expect(grainFor("2026-01-01", "2026-12-31")).toBe("month");
    expect(grainFor("2023-01-01", "2026-12-31")).toBe("year");
  });

  it("groups a line by hour of day, day, month and year", () => {
    const l = { sold_date_local: "2026-10-27", hour: 9 };
    expect(["hour", "day", "week", "month", "year"].map((g) => bucketOf(l, g as never))).toEqual(["09", "2026-10-27", "2026-W44", "2026-10", "2026"]);
  });

  it("ISO weeks start on Monday and belong to the year of their Thursday", () => {
    expect(isoWeekOf("2026-10-26")).toBe("2026-W44"); // Monday
    expect(isoWeekOf("2026-11-01")).toBe("2026-W44"); // Sunday of the same week
    expect(isoWeekOf("2026-11-02")).toBe("2026-W45");
    expect(isoWeekOf("2024-12-30")).toBe("2025-W01");
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
    expect(weekStart("2026-W44")).toBe("2026-10-26");
    expect(weekStart("2025-W01")).toBe("2024-12-30");
    expect(weekStart("2026-W53")).toBe("2026-12-28");
  });

  it("fills the weeks of a range, one bucket per ISO week, across a year change", () => {
    expect(bucketsOf("2026-10-28", "2026-11-10", "week", [])).toEqual(["2026-W44", "2026-W45", "2026-W46"]);
    expect(bucketsOf("2026-12-28", "2027-01-05", "week", [])).toEqual(["2026-W53", "2027-W01"]);
  });

  it("fills the days and months without sales, across a year change", () => {
    expect(bucketsOf("2026-10-30", "2026-11-01", "day", [])).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(bucketsOf("2026-11-15", "2027-01-02", "month", [])).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("hours run from the first to the last with sales", () => {
    expect(bucketsOf("2026-10-27", "2026-10-27", "hour", ["11", "09"])).toEqual(["09", "10", "11"]);
    expect(bucketsOf("2026-10-27", "2026-10-27", "hour", [])).toEqual([]);
  });
});

describe("buildInsights", () => {
  const build = (lines: InsightLine[], by: "establishment" | "seller" | "product" = "seller") =>
    buildInsights({
      from: "2026-10-27",
      to: "2026-10-28",
      grain: "day",
      by,
      lines,
      econ: lineEconomics(lines, ctx({ orders: new Map(), saleFees: new Map() })),
      previous: ZERO,
      previousRange: { from: "2026-10-25", to: "2026-10-26" },
      labels: { store: () => ({ label: "KT · Katy", color: "#123456" }), sellerName: (c) => (c === "ANA" ? "Ana" : null) },
      costRulesMissing: false,
      truncated: false,
    });

  it("adds up per bucket and per seller, biggest first, with a name and a share", () => {
    const d = build([line(), line({ order_id: "o2", sale_id: "s2", seller_code: "LUZ", total_cents: 21600, tax_cents: 1600, sold_date_local: "2026-10-28" })]);
    expect(d.series.map((p) => [p.bucket, p.sales, p.count])).toEqual([["2026-10-27", 108, 1], ["2026-10-28", 216, 1]]);
    expect(d.rows.map((r) => [r.key, r.label, r.share])).toEqual([["LUZ", null, 66.7], ["ANA", "Ana", 33.3]]);
    expect(d.totals.count).toBe(2);
    expect(d.compare[1]).toMatchObject({ key: "ANA", sales: [108, 0] });
  });

  it("a week series carries the Monday of each bucket", () => {
    const d = buildInsights({
      from: "2026-10-27",
      to: "2026-11-03",
      grain: "week",
      by: "seller",
      lines: [line(), line({ order_id: "o2", sale_id: "s2", sold_date_local: "2026-11-02" })],
      econ: lineEconomics([line(), line()], ctx({ orders: new Map(), saleFees: new Map() })),
      previous: ZERO,
      previousRange: { from: "2026-10-19", to: "2026-10-26" },
      labels: NO_LABELS,
      costRulesMissing: false,
      truncated: false,
    });
    expect(d.series.map((p) => [p.bucket, p.start, p.sales])).toEqual([["2026-W44", "2026-10-26", 108], ["2026-W45", "2026-11-02", 108]]);
    expect(d.compare[0].sales).toEqual([108, 108]);
  });

  it("groups by several dimensions in one pass; rows and compare are the main one", () => {
    const lines = [line(), line({ order_id: "o2", sale_id: "s2", seller_code: "LUZ", channel: "web", establishment_id: null, payment_methods: ["card"] })];
    const d = buildInsights({
      from: "2026-10-27",
      to: "2026-10-27",
      grain: "day",
      by: "seller",
      bys: ["establishment", "payment_method", "seller"],
      lines,
      econ: lineEconomics(lines, ctx({ orders: new Map(), saleFees: new Map() })),
      previous: ZERO,
      previousRange: { from: "2026-10-26", to: "2026-10-26" },
      labels: NO_LABELS,
      costRulesMissing: false,
      truncated: false,
    });
    expect(Object.keys(d.breakdowns).sort()).toEqual(["establishment", "payment_method", "seller"]);
    expect(d.rows).toBe(d.breakdowns.seller!.rows);
    expect(d.breakdowns.establishment!.rows.map((r) => r.key).sort()).toEqual(["est_1", "web"]);
    expect(d.breakdowns.payment_method!.rows.map((r) => [r.key, r.share])).toEqual([["cash", 50], ["card", 50]]);
    expect(d.breakdowns.payment_method!.compare.map((c) => c.sales)).toEqual([[108], [108]]);
  });

  it("a sale with two lines counts once and its units add up", () => {
    const d = build([line(), line({ product_id: "p2" })]);
    expect(d.totals.count).toBe(1);
    expect(d.totals.units).toBe(2);
  });

  it("labels a store with its color; a web sale is its own row", () => {
    const d = build([line(), line({ order_id: "o2", channel: "web", establishment_id: null, sale_id: null })], "establishment");
    expect(d.rows.find((r) => r.key === "est_1")).toMatchObject({ label: "KT · Katy", color: "#123456" });
    expect(d.rows.some((r) => r.key === "web")).toBe(true);
  });

  it("a customer's own frame is one product row, whatever the sale", () => {
    expect(keysOf(line({ category: "own_frame", product_id: null }), "product")).toEqual(["own_frame"]);
  });

  it("a sale paid two ways counts under both methods", () => {
    expect(keysOf(line({ payment_methods: ["cash", "card"] }), "payment_method")).toEqual(["cash", "card"]);
  });
});

describe("cash of the period (paid, balance)", () => {
  // A till sale of two lines, half collected, and a web order charged in full.
  const LINES = [
    line(),
    line({ product_id: "p2", sku: "FX2", title: "Lentes", category: "lens", total_cents: 10800, tax_cents: 800 }),
    line({ order_id: "w1", sale_id: null, channel: "web", establishment_id: null, seller_id: null, seller_code: "WEB", category: "case", product_id: "p9", total_cents: 5400, tax_cents: 400, sold_date_local: "2026-10-28" }),
  ];
  const CASH = new Map([["s1", { paid: 8000, balance: 13600 }]]);
  const build = (lines: InsightLine[], by: "seller" | "category" = "seller") =>
    buildInsights({
      from: "2026-10-27",
      to: "2026-10-28",
      grain: "day",
      by,
      lines,
      econ: lineEconomics(lines, ctx({ orders: new Map(), saleFees: new Map(), saleCash: CASH })),
      previous: ZERO,
      previousRange: { from: "2026-10-25", to: "2026-10-26" },
      labels: NO_LABELS,
      costRulesMissing: false,
      truncated: false,
    });

  it("a sale with several lines is collected once, not once per line", () => {
    const d = build(LINES);
    expect(d.totals.count).toBe(2);
    expect(d.totals.paid).toBe(134); // 80.00 of the till sale + the 54.00 web order
    expect(d.totals.balance).toBe(136); // only the till sale owes
  });

  it("a web order is paid in full when it is placed and owes nothing", () => {
    const d = build([LINES[2]]);
    expect([d.totals.paid, d.totals.balance, d.totals.sales]).toEqual([54, 0, 54]);
  });

  it("paid and balance add up to what the sales were charged", () => {
    const d = build(LINES);
    // 108.00 + 108.00 of the till sale (8000 + 13600 cents) plus 54.00 web.
    expect(d.totals.paid + d.totals.balance).toBe(d.totals.sales);
  });

  it("a day and a dimension row each count the sale's cash once", () => {
    const d = build(LINES, "category");
    expect(d.series.map((p) => p.bucket)).toEqual(["2026-10-27", "2026-10-28"]);
    const rows = new Map(d.rows.map((r) => [r.key, r]));
    // Both lines of the till sale are the same sale: neither its frame row nor
    // its lens row may claim more than the sale collected.
    expect(rows.get("frame")!.paid).toBe(80);
    expect(rows.get("lens")!.paid).toBe(80);
    expect(rows.get("case")!.paid).toBe(54);
    // And a sale that spans two categories therefore shows in both of them: the
    // rows of a dimension add up past the period's cash, exactly as `count`
    // already does. Only `totals` is the till.
    expect(d.rows.reduce((t, r) => t + r.paid, 0)).toBeGreaterThan(d.totals.paid);
    expect(d.series.reduce((t, p) => t + p.count, 0)).toBe(d.totals.count);
  });

  it("without pos_sale the sale reads as collected, never as a phantom debt", () => {
    const d = buildInsights({
      from: "2026-10-27",
      to: "2026-10-28",
      grain: "day",
      by: "seller",
      lines: LINES,
      econ: lineEconomics(LINES, ctx({ orders: new Map(), saleFees: new Map(), saleCash: undefined })),
      previous: ZERO,
      previousRange: { from: "2026-10-25", to: "2026-10-26" },
      labels: NO_LABELS,
      costRulesMissing: false,
      truncated: false,
    });
    expect([d.totals.paid, d.totals.balance]).toEqual([d.totals.sales, 0]);
  });
});

describe("redactInsights", () => {
  const data = () =>
    buildInsights({
      from: "2026-10-27",
      to: "2026-10-27",
      grain: "day",
      by: "seller",
      bys: ["establishment"],
      lines: [line()],
      econ: lineEconomics([line()], ctx()),
      previous: { ...ZERO, profit: 5, cost: 5, fee: 5, commission: 5, margin_pct: 5 },
      previousRange: { from: "2026-10-26", to: "2026-10-26" },
      labels: NO_LABELS,
      costRulesMissing: true,
      truncated: false,
    });

  it("no cost, fee, margin or profit leaves for someone without the privilege", () => {
    const d = redactInsights(data(), { profit: false, commission: false });
    for (const f of [d.totals, d.previous, d.rows[0]]) {
      expect([f.cost, f.fee, f.profit, f.commission, f.margin_pct]).toEqual([0, 0, 0, 0, null]);
    }
    expect(d.series[0].profit).toBe(0);
    expect(d.compare[0].profit).toEqual([0]);
    expect(d.compare[0].commission).toEqual([0]);
    const est = d.breakdowns.establishment!;
    expect([est.rows[0].profit, est.rows[0].cost, est.rows[0].margin_pct]).toEqual([0, 0, null]);
    expect(est.compare[0].profit).toEqual([0]);
    expect(d.cost_rules_missing).toBe(false);
    expect(d.totals.sales).toBe(108);
  });

  it("a seller sees their commission and still not the store's profit", () => {
    const d = redactInsights(data(), { profit: false, commission: true });
    expect(d.totals.commission).toBe(10);
    expect(d.totals.profit).toBe(0);
  });

  it("the till is not the margin: a seller keeps what they collected and what is owed", () => {
    const d = redactInsights(data(), { profit: false, commission: false });
    expect([d.totals.paid, d.totals.balance]).toEqual([80, 28]);
    expect([d.previous.paid, d.previous.balance]).toEqual([0, 0]);
    expect([d.rows[0].paid, d.rows[0].balance]).toEqual([80, 28]);
  });

  it("whoever holds the privilege sees everything", () => {
    const d = redactInsights(data(), { profit: true, commission: true });
    expect(d.totals.profit).toBe(52.5);
    expect(d.totals.margin_pct).toBe(52.5);
  });
});

describe("guard", () => {
  it("every role reaches the panel's route", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/sales-analytics/insights?grain=day")).toBe(true);
  });
});
