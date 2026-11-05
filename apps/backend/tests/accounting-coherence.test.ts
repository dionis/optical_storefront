import { readFileSync } from "fs";
import { join } from "path";
import { buildCashReport, type MethodLike, type PaymentRow } from "../src/lib/cash-report";
import type { CostRule } from "../src/lib/costing";
import { clearLensCellCostCache, lensCellCostsKnown, setLensCellCostCache } from "../src/lib/lens-cost";
import { saleInstantOf } from "../src/lib/sale-facts";
import { netLinesOf } from "../src/lib/sales-analytics";
import { costSourcesMissing, lineEconomics, type EconomicsContext, type InsightLine } from "../src/lib/sales-insights";
import { attributeSale, dashboardFigures, groupSellerStats, saleCommission, type DashboardOrder, type StatOrder } from "../src/lib/sellers";

/**
 * Coherence pass of 5-nov-2026 over the real QA database (qa/COHERENCIA.md,
 * docs/CONTABILIDAD.md «Verificación del 5-nov-2026»): one test per figure
 * that two screens could print differently. Cents are integers; the
 * expectation of every case is worked out by hand in its comment.
 */

const rule = (kind: CostRule["kind"], match_key: string, amount: number): CostRule => ({ kind, match_key, label: match_key, amount, unit: "fixed", active: true, sort_order: 0 });

// ── Banner «no hay costos» vs the cost beside it ─────────────────────────────

describe("costSourcesMissing: the «cost of goods is zero» banner", () => {
  const zeroRules = [rule("frame_brand", "flexure", 0), rule("lens_design", "sv", 0), rule("order_percent", "payment_fee", 2.9)];

  it("is true only when no source can answer: zero material rules, no supplier list, no lens cell cost", () => {
    expect(costSourcesMissing(zeroRules, false, false)).toBe(true);
  });

  it("is false as soon as the supplier list (store_frame_cost) was read — the QA base: rules at 0, cost $129.15 on screen", () => {
    expect(costSourcesMissing(zeroRules, true, false)).toBe(false);
  });

  it("is false when a lens cell carries a lab cost", () => {
    expect(costSourcesMissing(zeroRules, false, true)).toBe(false);
  });

  it("is false when a material rule has an amount; an inactive rule or a percent rule does not count", () => {
    expect(costSourcesMissing([rule("frame_brand", "flexure", 20)], false, false)).toBe(false);
    expect(costSourcesMissing([{ ...rule("frame_brand", "flexure", 20), active: false }], false, false)).toBe(true);
    expect(costSourcesMissing([rule("order_percent", "payment_fee", 2.9), rule("order_fixed", "lab", 1)], false, false)).toBe(true);
  });

  it("lensCellCostsKnown reads the cache: unloaded → false, cells without cost → false, one priced cell → true", () => {
    clearLensCellCostCache();
    expect(lensCellCostsKnown()).toBe(false);
    setLensCellCostCache([{ design_code: "sv", material_code: "cr39", finish: "stock", cost_cents: null }]);
    expect(lensCellCostsKnown()).toBe(false);
    setLensCellCostCache([
      { design_code: "sv", material_code: "cr39", finish: "stock", cost_cents: null },
      { design_code: "sv", material_code: "cr39", finish: "digital", cost_cents: 2850 },
    ]);
    expect(lensCellCostsKnown()).toBe(true);
    clearLensCellCostCache();
  });
});

// ── One clock for a till sale ────────────────────────────────────────────────

describe("saleInstantOf: the Executive buckets a till sale on pos_sale.created_at, like the statement", () => {
  it("prefers the till sale's instant over the order's (written ~200 ms earlier)", () => {
    const order = "2026-11-05T17:33:56.971Z";
    const sale = new Date("2026-11-05T17:33:57.176Z");
    expect(saleInstantOf(order, sale).toISOString()).toBe("2026-11-05T17:33:57.176Z");
    expect(saleInstantOf(order, "2026-11-05T17:33:57.176Z").toISOString()).toBe("2026-11-05T17:33:57.176Z");
  });

  it("a web order (no till sale) keeps its own created_at; garbage falls back too", () => {
    expect(saleInstantOf("2026-11-05T17:33:56.971Z", null).toISOString()).toBe("2026-11-05T17:33:56.971Z");
    expect(saleInstantOf("2026-11-05T17:33:56.971Z", "not a date").toISOString()).toBe("2026-11-05T17:33:56.971Z");
  });

  it("at midnight the two clocks would split one sale over two days: 23:59:59.900 local vs 00:00:00.100", () => {
    // America/Chicago, CST (UTC−6): 05:59:59.900Z is still the 5th; 06:00:00.100Z is the 6th.
    const order = "2026-11-06T05:59:59.900Z";
    const sale = "2026-11-06T06:00:00.100Z";
    const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    expect(localDay(new Date(order))).toBe("2026-11-05");
    expect(localDay(saleInstantOf(order, sale))).toBe("2026-11-06");
  });
});

// ── Commission rounded per line, everywhere ──────────────────────────────────

describe("saleCommission: per line, the Executive's arithmetic", () => {
  it("two nets of $71.33 at 8 % are $5.71 + $5.71 = $11.42 per line; rounding once over $142.66 gives $11.41", () => {
    // 7133 × 8 / 100 = 570.64 → 571 ¢ each line.
    expect(saleCommission({ total: 71.33, tax_total: 0, net_cents_lines: [7133] }, 8)).toBe(5.71);
    const twoLines = saleCommission({ total: 142.66, tax_total: 0, net_cents_lines: [7133, 7133] }, 8);
    expect(twoLines).toBe(11.42);
    expect(Math.round(142.66 * 8) / 100).toBe(11.41); // what a single rounding would print
  });

  it("without line nets (a board row) the order's net is rounded once; 0 % is 0", () => {
    expect(saleCommission({ total: 107, tax_total: 7, shipping_total: 0 }, 10)).toBe(10);
    expect(saleCommission({ total: 107, tax_total: 7, net_cents_lines: [10000] }, 0)).toBe(0);
  });

  it("matches lineEconomics cent for cent on a two-line order", () => {
    const lines: InsightLine[] = [7133, 7133].map((cents, i) => ({
      order_id: "o1", sale_id: "s1", channel: "pos", establishment_id: "est_1", terminal_id: null, seller_id: "u1", seller_code: "SOFIA",
      product_id: `p${i}`, sku: null, title: "x", brand: null, brand_slug: null, category: "own_frame", lens_design: null, lens_material: null,
      lens_photo: null, lens_ar: null, payment_methods: ["cash"], qty: 1, total_cents: cents, tax_cents: 0, sold_date_local: "2026-11-05", hour: 11,
    }));
    const ctx: EconomicsContext = { rules: [], orders: new Map([["o1", { gross: 14266, net: 14266, lines: 2 }]]), saleFees: new Map(), commissionPct: () => 8 };
    const econ = lineEconomics(lines, ctx);
    const executive = econ.reduce((s, e) => s + e.commission, 0) / 100;
    expect(executive).toBe(11.42);
    expect(saleCommission({ total: 142.66, tax_total: 0, net_cents_lines: [7133, 7133] }, 8)).toBe(executive);
  });

  it("groupSellerStats adds the per-sale commission: Σ sales, never one rounding over the month", () => {
    const sellers = [{ id: "s1", code: "SOFIA", name: "Sofía", commission_pct: 8, active: true, user_id: "u_sofia" }];
    const sale = (id: string): StatOrder => ({ id, channel: "pos", seller_id: "u_sofia", seller_code: "SOFIA", total: 71.33, tax_total: 0, net_cents_lines: [7133], created_at: "2026-11-05T15:00:00Z", units: 1 });
    const { sellers: rows } = groupSellerStats([sale("a"), sale("b")], sellers);
    expect(rows[0]).toMatchObject({ orders: 2, revenue: 142.66, net_revenue: 142.66, commission: 11.42 });
  });

  it("netLinesOf reads the aggregate as an array or as Postgres text", () => {
    expect(netLinesOf([7133, "6000"])).toEqual([7133, 6000]);
    expect(netLinesOf("{7133,6000}")).toEqual([7133, 6000]);
    expect(netLinesOf(null)).toEqual([]);
  });
});

// ── The seller's public dashboard = their row of Vendedores ──────────────────

describe("dashboardFigures: /store/seller-dashboard reads sale_fact with the Vendedores rule", () => {
  const pct = 8;
  const o = (over: Partial<DashboardOrder> & { id: string; sold_date_local: string }): DashboardOrder => ({
    channel: "pos", seller_id: "u_sofia", seller_code: "SOFIA", total: 71.33, tax_total: 0, shipping_total: 0, net_cents_lines: [7133], created_at: `${over.sold_date_local}T15:00:00.000Z`, units: 1, ...over,
  });
  const mine = [
    o({ id: "a", sold_date_local: "2026-11-05" }),
    o({ id: "b", sold_date_local: "2026-11-05", total: 107, tax_total: 7, net_cents_lines: [10000] }),
    o({ id: "c", sold_date_local: "2026-10-31" }), // last month: all_time only
    o({ id: "w", sold_date_local: "2026-11-03", channel: "web", seller_id: null, seller_code: "SOFIA", seller_source: "instagram", total: 50, tax_total: 0, net_cents_lines: [5000] }),
  ];

  it("period by LOCAL day, all_time over everything, commission on the net per line", () => {
    const f = dashboardFigures(mine, pct, { from: "2026-11-01", to: "2026-11-30" });
    // period: 71.33 + 107 + 50 = 228.33; net 71.33 + 100 + 50 = 221.33; commission 571 + 800 + 400 = 1771 ¢
    expect(f.period).toEqual({ orders: 3, revenue: 228.33, net_revenue: 221.33, commission: 17.71 });
    // all_time adds c: +71.33 / +571 ¢
    expect(f.all_time).toEqual({ orders: 4, revenue: 299.66, net_revenue: 292.66, commission: 23.42 });
    // newest day first; within a day, the later instant first
    expect(f.in_period.map((x) => x.sold_date_local)).toEqual(["2026-11-05", "2026-11-05", "2026-11-03"]);
    expect(new Set(f.in_period.map((x) => x.id))).toEqual(new Set(["a", "b", "w"]));
  });

  it("by_source splits the period into counter and the referral networks, each with its commission", () => {
    const f = dashboardFigures(mine, pct, { from: "2026-11-01", to: "2026-11-30" });
    expect(f.by_source).toEqual([
      { source: "counter", orders: 2, revenue: 178.33, commission: 13.71 },
      { source: "instagram", orders: 1, revenue: 50, commission: 4 },
    ]);
  });

  it("is the same number Vendedores prints for the same seller and period (identity of docs §7)", () => {
    const sellers = [{ id: "s1", code: "SOFIA", name: "Sofía", commission_pct: pct, active: true, user_id: "u_sofia" }];
    const inMonth = mine.filter((x) => x.sold_date_local >= "2026-11-01");
    const { sellers: rows } = groupSellerStats(inMonth, sellers);
    const f = dashboardFigures(mine, pct, { from: "2026-11-01", to: "2026-11-30" });
    expect([rows[0].orders, rows[0].revenue, rows[0].net_revenue, rows[0].commission]).toEqual([f.period.orders, f.period.revenue, f.period.net_revenue, f.period.commission]);
  });

  it("attribution: the till user wins over the code, a code of nobody is unattributed — the dashboard filters with the same maps", () => {
    const byUser = new Map([["u_sofia", "SOFIA"]]);
    const byCode = new Map([["SOFIA", true], ["LUIS", true]]);
    expect(attributeSale({ seller_id: "u_sofia", seller_code: "LUIS" }, byUser, byCode)).toBe("SOFIA");
    expect(attributeSale({ seller_id: null, seller_code: "luis" }, byUser, byCode)).toBe("LUIS");
    expect(attributeSale({ seller_id: "u_owner", seller_code: "O01" }, byUser, byCode)).toBeNull();
  });

  it("the route reads sale_fact (sellerFactOrders + attributeSale), never the order board window", () => {
    const route = readFileSync(join(__dirname, "..", "src", "api", "store", "seller-dashboard", "route.ts"), "utf8");
    expect(route).toMatch(/sellerFactOrders/);
    expect(route).toMatch(/attributeSale/);
    expect(route).toMatch(/dashboardFigures/);
    expect(route).not.toMatch(/scanBoardWindow/);
    // commission never on the gross
    expect(route).not.toMatch(/total\s*\*\s*pct/);
  });
});

// ── The processor fee of a voided sale ───────────────────────────────────────

describe("cash report: the fee of a VOIDED card sale is not a cost of the period", () => {
  const methods: MethodLike[] = [
    { code: "cash", label: null, label_en: null, kind: "cash", counts_as_cash: true, builtin: true, receivable: false },
    { code: "credit", label: null, label_en: null, kind: "credit", counts_as_cash: false, builtin: true, receivable: false },
  ];
  const pay = (over: Partial<PaymentRow>): PaymentRow => ({ id: "p", day: "2026-11-05", method_code: "credit", amount_cents: 40000, fee_cents: 1190, kind: "deposit", counts_as_cash: false, received_by: null, establishment_id: "est_1", ...over });

  it("a live $400 card sale charges its $11.90; the same sale voided (deposit kept, refund at fee 0) charges nothing — like the Executive and the P&L", () => {
    const live = buildCashReport({ from: "2026-11-05", to: "2026-11-05", payments: [pay({ id: "a", sale_status: "completed" })], movements: [], sessions: [], methods });
    expect(live.totals.fees_cents).toBe(1190);
    const voided = buildCashReport({
      from: "2026-11-05",
      to: "2026-11-05",
      payments: [pay({ id: "a", sale_status: "voided" }), pay({ id: "b", kind: "refund", amount_cents: -40000, fee_cents: 0, sale_status: "voided" })],
      movements: [],
      sessions: [],
      methods,
    });
    expect(voided.totals.fees_cents).toBe(0);
    expect(voided.by_method[0]).toMatchObject({ code: "credit", in_cents: 40000, refund_cents: 40000, net_cents: 0, fee_cents: 0 });
    // the money still shows: it went in and came back out
    expect(voided.totals.payments_cents).toBe(0);
  });

  it("rows without a status (older callers, fixtures) keep charging their fee", () => {
    const r = buildCashReport({ from: "2026-11-05", to: "2026-11-05", payments: [pay({ id: "a" })], movements: [], sessions: [], methods });
    expect(r.totals.fees_cents).toBe(1190);
  });
});
