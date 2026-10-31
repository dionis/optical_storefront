import type { CostRule } from "../src/lib/costing";
import { filterBoardRows, matchesStore, projectBoardOrder } from "../src/lib/order-board";
import type { SaleListRow } from "../src/lib/sales-analytics";
import {
  attachSaleEconomics,
  insightAccess,
  lineEconomics,
  sumEconomicsByOrder,
  type EconomicsContext,
  type InsightLine,
} from "../src/lib/sales-insights";
import { isAllowedForRestrictedRole } from "../src/lib/staff-roles";

/**
 * The list of a store's sales (GET /admin/sales-analytics/sales) with each
 * sale's money, and the store filter of the executive panel's routes.
 */

const rule = (kind: CostRule["kind"], match_key: string, amount: number, unit: CostRule["unit"] = "fixed"): CostRule => ({ kind, match_key, label: match_key, amount, unit, active: true, sort_order: 0 });
const RULES = [rule("frame_brand", "flexure", 20), rule("lens_design", "sv", 10), rule("order_fixed", "lab", 5), rule("order_percent", "payment_fee", 3, "percent")];

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
  orders: new Map([["o1", { gross: 21600, net: 20000, lines: 2 }], ["o2", { gross: 10800, net: 10000, lines: 1 }]]),
  saleFees: new Map([["s1", 250]]),
  commissionPct: () => 10,
  ...over,
});

const row = (over: Partial<SaleListRow> = {}): SaleListRow => ({
  order_id: "o1",
  sale_id: "s1",
  number: "Op1-000001",
  channel: "pos",
  establishment_id: "est_1",
  seller_code: "ANA",
  customer: "Ana García",
  sold_at: "2026-10-27T15:00:00.000Z",
  total: 216,
  discount: 0,
  units: 2,
  status: "active",
  items: "Flex 1 · Flex 1",
  paid: 100,
  balance: 116,
  ...over,
});

describe("sumEconomicsByOrder", () => {
  it("adds a sale's lines up and keeps the missing-cost flag if any line lacks a rule", () => {
    const lines = [line(), line({ sku: "FX2", brand_slug: "unknown", brand: "Unknown" }), line({ order_id: "o2", sale_id: null, channel: "web", seller_id: null, seller_code: null })];
    const econ = lineEconomics(lines, ctx());
    const byOrder = sumEconomicsByOrder(lines, econ);
    const o1 = byOrder.get("o1")!;
    expect(o1.net).toBe(20000);
    expect(o1.cost).toBe(econ[0].cost + econ[1].cost);
    expect(o1.fee).toBe(250); // the recorded fee of the till sale, split over its two lines
    expect(o1.commission).toBe(2000);
    expect(o1.profit).toBe(o1.net - o1.cost - o1.fee - o1.commission);
    expect(o1.missing_cost).toBe(true);
    const o2 = byOrder.get("o2")!;
    expect(o2.missing_cost).toBe(false);
    expect(o2.fee).toBe(324); // 3 % of 108.00, the web gateway rule
  });

  it("an empty list has no orders", () => {
    expect(sumEconomicsByOrder([], []).size).toBe(0);
  });
});

describe("attachSaleEconomics", () => {
  const econ = new Map([["o1", { net: 20000, cost: 6500, fee: 250, commission: 2000, profit: 11250, missing_cost: false }]]);

  it("puts the money of each sale on its row, in dollars, with its margin over the net", () => {
    const [r] = attachSaleEconomics([row()], econ, { profit: true, commission: true });
    expect(r).toMatchObject({ net: 200, cost: 65, fee: 2.5, commission: 20, profit: 112.5, margin_pct: 56.3, missing_cost: false, paid: 100, balance: 116 });
  });

  it("redacts cost, fee, profit and margin for someone without the privilege; a seller keeps their commission", () => {
    const [r] = attachSaleEconomics([row()], econ, { profit: false, commission: true });
    expect(r).toMatchObject({ cost: null, fee: null, profit: null, margin_pct: null, missing_cost: null, commission: 20 });
    const [n] = attachSaleEconomics([row()], econ, { profit: false, commission: false });
    expect(n.commission).toBeNull();
    // What the sale collected is not a cost: everyone with the list sees it.
    expect(n.paid).toBe(100);
    expect(n.balance).toBe(116);
  });

  it("a sale without lines in the period reads as unknown, not as zero profit", () => {
    const [r] = attachSaleEconomics([row({ order_id: "o9" })], econ, { profit: true, commission: true });
    expect(r.profit).toBeNull();
    expect(r.margin_pct).toBeNull();
  });
});

describe("insightAccess", () => {
  it("profit for admins and the costs privileges; the commission also for a seller", () => {
    expect(insightAccess({ is_admin: true, role: "owner" })).toMatchObject({ profit: true, commission: true });
    expect(insightAccess({ is_admin: false, role: "manager", privileges: ["costs.view"] })).toMatchObject({ profit: true, commission: true });
    expect(insightAccess({ is_admin: false, role: "manager", privileges: [] })).toMatchObject({ profit: false, commission: false });
    expect(insightAccess({ is_admin: false, role: "seller", privileges: [] })).toMatchObject({ profit: false, commission: true, role: "seller" });
  });
});

describe("store filter of the board-based routes", () => {
  const order = (metadata: Record<string, unknown>) => projectBoardOrder({ id: "ord_1", created_at: "2026-10-27T15:00:00Z", status: "pending", payment_status: "captured", fulfillment_status: "not_fulfilled", metadata, items: [], fulfillments: [] } as never);

  it("a till sale carries its store; a web order is the online store", () => {
    const till = order({ source: "pos", establishment_id: "est_1" });
    const web = order({ seller_code: "ANA" });
    expect(till).toMatchObject({ channel: "pos", establishment_id: "est_1" });
    expect(web).toMatchObject({ channel: "web", establishment_id: null });
    expect(matchesStore(till, "est_1")).toBe(true);
    expect(matchesStore(till, "est_2")).toBe(false);
    expect(matchesStore(till, "web")).toBe(false);
    expect(matchesStore(web, "web")).toBe(true);
    expect(matchesStore(web, "est_1")).toBe(false);
    expect(matchesStore(web, "")).toBe(true);
    expect(matchesStore(till, "all")).toBe(true);
  });

  it("the board keeps only the store asked for", () => {
    const rows = [order({ source: "pos", establishment_id: "est_1" }), order({})];
    expect(filterBoardRows(rows, { store: "web" })).toHaveLength(1);
    expect(filterBoardRows(rows, { store: "est_1" })).toHaveLength(1);
    expect(filterBoardRows(rows, {})).toHaveLength(2);
  });
});

describe("guard", () => {
  it("the sales list is reachable by every role (scoped by analytics-route)", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/sales-analytics/sales?from=2026-10-01&to=2026-10-31&stores=est_1")).toBe(true);
  });
});
