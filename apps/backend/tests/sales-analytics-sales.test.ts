import type { CostRule } from "../src/lib/costing";
import { filterBoardRows, matchesStore, projectBoardOrder } from "../src/lib/order-board";
import { lensSummaryOf, saleListRowOf, salesPageSize, SALES_PAGE_DEFAULT, SALES_PAGE_MAX, type SaleListRaw, type SaleListRow } from "../src/lib/sales-analytics";
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
  saleCash: new Map([["s1", { paid: 10000, balance: 11600 }]]),
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

describe("saleListRowOf (the report columns of a sale)", () => {
  const raw = (over: Partial<SaleListRaw> = {}): SaleListRaw => ({
    order_id: "o1",
    sale_id: "s1",
    number: "Op1-000001",
    channel: "pos",
    establishment_id: "est_1",
    seller_code: "ANA",
    customer_id: "c1",
    sold_at: "2026-10-27T15:00:00.000Z",
    total: "21600",
    discount: "0",
    units: 2,
    status: "active",
    items: "Flex 1 · Flex 1",
    frame_brand: "Flexure",
    frame_model: "Flex 1",
    frame_sku: "FX1-BLK",
    frame_line_id: "li_1",
    own_frame: false,
    has_rx: true,
    lens_design: "sv",
    lens_material: "cr39",
    lens_photo: null,
    lens_ar: "ar_premium",
    ...over,
  });
  const labels = {
    designs: new Map([["sv", { label_es: "Monofocal", label_en: "Single vision" }]]),
    materials: new Map([["cr39", { label_es: "CR-39", label_en: "CR-39" }]]),
    photos: new Map(),
    ars: new Map(),
  };

  it("a catalog frame with prescription lenses: brand, model, colour from the variant, lenses labelled per language", () => {
    const r = saleListRowOf(raw(), {
      sale: { paid_cents: 10000, balance_cents: 11600 },
      customer: { first_name: "Ana", last_name: "García", email: "ana@x.com", phone: "+1 832 555 0100" },
      line: { variant_title: "Negro mate", metadata: null },
      labels,
    });
    expect(r).toMatchObject({
      order_id: "o1", number: "Op1-000001", total: 216, paid: 100, balance: 116,
      customer: "Ana García", customer_phone: "+1 832 555 0100",
      frame_brand: "Flexure", frame_model: "Flex 1", frame_color: "Negro mate", frame_sku: "FX1-BLK",
      own_frame: false, has_rx: true,
      lens: { design: "sv", material: "cr39", photo: null, ar: "ar_premium" },
      lens_summary: { es: "Monofocal · CR-39 · ar_premium", en: "Single vision · CR-39 · ar_premium" },
    });
  });

  it("an own frame takes the customer's description as model and has no colour nor SKU; a web order is paid in full", () => {
    const r = saleListRowOf(raw({ sale_id: null, channel: "web", frame_brand: null, frame_model: null, frame_sku: null, own_frame: true, lens_ar: null }), {
      customer: { first_name: null, last_name: null, email: "web@x.com", phone: null },
      line: { variant_title: null, metadata: { own_frame: { description: "Ray-Ban del cliente" } } },
      labels,
    });
    expect(r).toMatchObject({ customer: "web@x.com", customer_phone: null, paid: 216, balance: 0, frame_brand: null, frame_model: "Ray-Ban del cliente", frame_color: null, frame_sku: null, own_frame: true, has_rx: true });
    expect(r.lens_summary).toEqual({ es: "Monofocal · CR-39", en: "Single vision · CR-39" });
  });

  it("a frame-only sale has no lenses, no prescription and keeps the old fields untouched", () => {
    const r = saleListRowOf(raw({ has_rx: false, lens_design: null, lens_material: null, lens_photo: null, lens_ar: null }));
    expect(r).toMatchObject({ has_rx: false, own_frame: false, lens: null, lens_summary: null, customer: null, frame_color: null, items: "Flex 1 · Flex 1", units: 2, discount: 0 });
    expect(lensSummaryOf({ design: null, material: null, photo: null, ar: null })).toBeNull();
  });

  it("the lens summary falls back to the code when the catalog has no label, and to the other language's label", () => {
    const s = lensSummaryOf({ design: "sv", material: "poly", photo: "trans", ar: null }, { ...labels, photos: new Map([["trans", { label_es: "Transitions", label_en: null }]]) });
    expect(s).toEqual({ es: "Monofocal · poly · Transitions", en: "Single vision · poly · Transitions" });
  });
});

describe("salesPageSize (the client picks the window of a page)", () => {
  it("defaults to a hundred sales and never goes past the cap", () => {
    expect(salesPageSize(undefined)).toBe(SALES_PAGE_DEFAULT);
    expect(salesPageSize("200")).toBe(SALES_PAGE_MAX);
    expect(salesPageSize(1000)).toBe(SALES_PAGE_MAX);
    expect(salesPageSize("25")).toBe(25);
    expect(salesPageSize(1)).toBe(1);
  });

  it("falls back to the default rather than returning an empty or broken page", () => {
    for (const bad of ["", "abc", "0", -5, 0.4, null, NaN, [], {}]) expect(salesPageSize(bad)).toBe(SALES_PAGE_DEFAULT);
    expect(salesPageSize("25.9")).toBe(25);
  });
});

describe("the collected and the owed of a sale (paid, balance)", () => {
  it("come from the sale, so its lines never collect it twice", () => {
    const lines = [line(), line({ product_id: "p2", sku: "FX2", category: "lens" })];
    const econ = lineEconomics(lines, ctx());
    // Every line of the sale carries the WHOLE sale's cash: whoever adds them up
    // counts it once per order, as lib/sales-insights.ts `add` does.
    expect(econ.map((e) => [e.paid, e.balance])).toEqual([[10000, 11600], [10000, 11600]]);
    const row = saleListRowOf(
      { order_id: "o1", sale_id: "s1", number: null, channel: "pos", establishment_id: "est_1", seller_code: "ANA", customer_id: null, sold_at: "2026-10-27T15:00:00.000Z", total: "21600", discount: "0", units: 2, status: "active", items: "", frame_brand: null, frame_model: null, frame_sku: null, frame_line_id: null, own_frame: false, has_rx: false, lens_design: null, lens_material: null, lens_photo: null, lens_ar: null },
      { sale: { paid_cents: 10000, balance_cents: 11600 } }
    );
    // The same figures the list shows for that sale, in dollars.
    expect([row.paid, row.balance]).toEqual([econ[0].paid / 100, econ[0].balance / 100]);
  });

  it("a web order is collected in full, like its row in the list", () => {
    const web = line({ order_id: "o2", sale_id: null, channel: "web", seller_id: null, seller_code: null });
    const [e] = lineEconomics([web], ctx());
    expect([e.paid, e.balance]).toEqual([10800, 0]);
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
