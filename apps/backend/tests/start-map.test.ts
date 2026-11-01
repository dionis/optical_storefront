import { PosError } from "../src/lib/pos-data";
import type { InsightLine, LineEconomics } from "../src/lib/sales-insights";
import { isAllowedForRestrictedRole } from "../src/lib/staff-roles";
import { aggregateSales, labBucketOf, pendingOf, periodRanges, resolveStartScope, resolveSubjectScope, type OpenSaleRow } from "../src/lib/start-map";

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
  lens_design: null,
  lens_material: null,
  lens_photo: null,
  lens_ar: null,
  payment_methods: ["cash"],
  qty: 1,
  total_cents: 10000,
  tax_cents: 0,
  sold_date_local: "2026-11-01",
  hour: 10,
  ...over,
});

const econ = (over: Partial<LineEconomics> = {}): LineEconomics => ({ net: 10000, cost: 3000, fee: 200, commission: 500, profit: 6300, paid: 10800, balance: 0, missing_cost: false, ...over });

describe("periodRanges", () => {
  it("cuts the calendar from a local day: weeks start on Monday, the span starts on the 1st of last month", () => {
    // Sunday 2026-11-01
    const pr = periodRanges("2026-11-01", 0);
    expect(pr.ranges.today).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(pr.ranges.yesterday).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(pr.ranges.this_week).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(pr.ranges.last_week).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(pr.ranges.this_month).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(pr.ranges.last_month).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(pr.span).toEqual({ from: "2026-10-01", to: "2026-11-01" });
  });

  it("compares each period with its previous equivalent, and only inside the span", () => {
    // Wednesday 2026-03-04
    const pr = periodRanges("2026-03-04", 3);
    expect(pr.previous.today).toEqual(pr.ranges.yesterday);
    expect(pr.previous.yesterday).toEqual({ from: "2026-03-02", to: "2026-03-02" });
    expect(pr.previous.this_week).toEqual(pr.ranges.last_week);
    expect(pr.previous.last_week).toEqual({ from: "2026-02-16", to: "2026-02-22" });
    expect(pr.previous.this_month).toEqual(pr.ranges.last_month);
    expect(pr.previous.last_month).toBeNull();
    expect(pr.ranges.last_month).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("aggregateSales", () => {
  const pr = periodRanges("2026-11-04", 3); // Wednesday
  const lines = [
    line({ order_id: "a", sold_date_local: "2026-11-04", total_cents: 10000 }),
    line({ order_id: "a", sold_date_local: "2026-11-04", total_cents: 5000, qty: 2, sku: "L1" }),
    line({ order_id: "b", sold_date_local: "2026-11-03", total_cents: 7000 }),
    line({ order_id: "c", sold_date_local: "2026-10-28", total_cents: 4000, channel: "web", establishment_id: null }),
    line({ order_id: "d", sold_date_local: "2026-10-05", total_cents: 9000, establishment_id: "est_2" }),
  ];
  const e = [econ(), econ({ cost: 1000, fee: 0, commission: 0, profit: 4000 }), econ(), econ(), econ()];

  it("adds sales, orders and units per period and puts the previous period beside", () => {
    const { periods } = aggregateSales(lines, e, pr, { profit: true, commission: true });
    expect(periods.today).toMatchObject({ from: "2026-11-04", sales_cents: 15000, count: 1, units: 3, cost_cents: 4200, profit_cents: 10300, commission_cents: 500, avg_ticket_cents: 15000, avg_profit_per_sale_cents: 10300 });
    expect(periods.this_week).toMatchObject({ avg_ticket_cents: 11000, avg_profit_per_sale_cents: 8300 });
    expect(periods.today.prev).toMatchObject({ sales_cents: 7000, count: 1 });
    expect(periods.yesterday).toMatchObject({ sales_cents: 7000, count: 1, prev: { sales_cents: 0, count: 0 } });
    expect(periods.this_week).toMatchObject({ sales_cents: 22000, count: 2 });
    expect(periods.last_week).toMatchObject({ sales_cents: 4000, count: 1 });
    expect(periods.this_month).toMatchObject({ sales_cents: 22000, prev: { sales_cents: 13000, count: 2 } });
    expect(periods.last_month).toMatchObject({ sales_cents: 13000, count: 2, prev: null });
  });

  it("keeps cost and profit null when the caller may not see them, commission when allowed", () => {
    const { periods } = aggregateSales(lines, e, pr, { profit: false, commission: true });
    expect(periods.today.cost_cents).toBeNull();
    expect(periods.today.profit_cents).toBeNull();
    expect(periods.today.avg_profit_per_sale_cents).toBeNull();
    expect(periods.today.avg_ticket_cents).toBe(15000);
    expect(periods.today.commission_cents).toBe(500);
    const none = aggregateSales(lines, null, pr, { profit: true, commission: true });
    expect(none.periods.today).toMatchObject({ sales_cents: 15000, cost_cents: null, commission_cents: null });
  });

  it("splits today, this week and this month per store, the web as its own", () => {
    const { byStore } = aggregateSales(lines, null, pr, { profit: false, commission: false });
    expect(byStore.get("est_1")).toEqual({ today_cents: 15000, week_cents: 22000, month_cents: 22000 });
    expect(byStore.get("web")).toEqual({ today_cents: 0, week_cents: 0, month_cents: 0 });
    expect(byStore.get("est_2")).toEqual({ today_cents: 0, week_cents: 0, month_cents: 0 });
  });
});

describe("pendingOf", () => {
  const sale = (over: Partial<OpenSaleRow> = {}): OpenSaleRow => ({
    id: "s",
    establishment_id: "est_1",
    seller_id: "u1",
    order_id: "o",
    status: "completed",
    total_cents: 20000,
    balance_cents: 0,
    promised_on: null,
    delivered_at: null,
    ...over,
  });
  const sales: OpenSaleRow[] = [
    sale({ id: "lab", order_id: "o1", balance_cents: 5000, promised_on: "2026-11-10" }),
    sale({ id: "ready", order_id: "o2", balance_cents: 8000, promised_on: "2026-10-30" }),
    sale({ id: "unknown", order_id: "o3" }),
    sale({ id: "canceled", order_id: "o4" }),
    sale({ id: "handed", order_id: "o5", delivered_at: "2026-10-20T10:00:00Z", balance_cents: 1500, promised_on: "2026-10-01" }),
    sale({ id: "other", order_id: "o6", seller_id: "u2", establishment_id: "est_2", balance_cents: 3000, promised_on: "2026-10-01" }),
    sale({ id: "voided", order_id: "o7", status: "voided", balance_cents: 9000 }),
  ];
  const stages: Record<string, "in_lab" | "shipped" | "terminal" | "confirmed"> = { o1: "in_lab", o2: "shipped", o4: "terminal", o6: "confirmed" };
  const stageOf = (id: string | null) => (id ? stages[id] : undefined);

  it("sorts open sales by the lab rule: before shipped in the lab, after it to deliver, canceled nowhere", () => {
    expect(labBucketOf(sale(), "in_lab")).toBe("in_lab");
    expect(labBucketOf(sale(), "confirmed")).toBe("in_lab");
    expect(labBucketOf(sale(), undefined)).toBe("in_lab");
    expect(labBucketOf(sale(), "shipped")).toBe("to_deliver");
    expect(labBucketOf(sale(), "in_transit")).toBe("to_deliver");
    expect(labBucketOf(sale(), "terminal")).toBeNull();
    expect(labBucketOf(sale({ delivered_at: "2026-10-01T00:00:00Z" }), "in_lab")).toBeNull();
    expect(labBucketOf(sale({ status: "voided" }), "in_lab")).toBeNull();
  });

  it("counts the whole scope for an admin: lab, to deliver, money on the street and overdue", () => {
    const { pending, byStore } = pendingOf(sales, stageOf, { today: "2026-11-04", ownSellerId: null, collectStores: null });
    expect(pending.in_lab).toEqual({ count: 3, cents: 60000, balance_cents: 8000 }); // lab + unknown + other
    expect(pending.to_deliver).toEqual({ count: 1, cents: 20000, balance_cents: 8000 });
    // Balances: lab 5000 + ready 8000 + handed 1500 + other 3000; the voided sale never.
    expect(pending.on_street).toEqual({ count: 4, cents: 17500 });
    // Overdue: ready (10-30), handed (10-01), other (10-01).
    expect(pending.overdue_balances).toEqual({ count: 3, cents: 12500 });
    expect(byStore.get("est_1")).toEqual({ on_street_cents: 14500, in_lab: 2, to_deliver: 1 });
    expect(byStore.get("est_2")).toEqual({ on_street_cents: 3000, in_lab: 1, to_deliver: 0 });
  });

  it("gives a seller only their own lab orders, but the balances of their store", () => {
    const { pending } = pendingOf(sales, stageOf, { today: "2026-11-04", ownSellerId: "u1", collectStores: ["est_1"] });
    expect(pending.in_lab.count).toBe(2);
    expect(pending.to_deliver.count).toBe(1);
    expect(pending.on_street).toEqual({ count: 3, cents: 14500 });
    expect(pending.overdue_balances).toEqual({ count: 2, cents: 9500 });
  });
});

describe("resolveStartScope", () => {
  const stores = [{ id: "est_1", is_active: true }, { id: "est_2", is_active: true }, { id: "est_old", is_active: false }];
  const admin = { is_admin: true, role: "owner" as const, establishment_ids: null, user_id: "boss", seller: null };
  const manager = { is_admin: false, role: "manager" as const, establishment_ids: ["est_1"], user_id: "mgr", seller: null };
  const seller = { is_admin: false, role: "seller" as const, establishment_ids: ["est_1", "est_2"], user_id: "ana", seller: { id: "sel", code: "ANA", active: true, establishment_id: "est_2", terminal_id: null } };

  it("admin: everything, one store, or the web (which has no counter pending)", () => {
    expect(resolveStartScope(admin, stores, "")).toMatchObject({ sales: { stores: null, sellers: null }, pendingStores: null, collectStores: null, showStores: true });
    expect(resolveStartScope(admin, stores, "est_2")).toMatchObject({ sales: { stores: ["est_2"] }, pendingStores: ["est_2"], collectStores: ["est_2"] });
    expect(resolveStartScope(admin, stores, "web")).toMatchObject({ sales: { stores: ["web"] }, pendingStores: ["-"], collectStores: ["-"] });
    expect(() => resolveStartScope(admin, stores, "est_nope")).toThrow(PosError);
  });

  it("manager: their stores, never the web nor another store", () => {
    expect(resolveStartScope(manager, stores, "all")).toMatchObject({ sales: { stores: ["est_1"] }, pendingStores: ["est_1"], ownSellerId: null, showStores: true });
    expect(() => resolveStartScope(manager, stores, "est_2")).toThrow(PosError);
    expect(() => resolveStartScope(manager, stores, "web")).toThrow(PosError);
  });

  it("seller: their own sales wherever, the balances of the store they sell in, no store lines", () => {
    const s = resolveStartScope(seller, stores, "");
    expect(s).toMatchObject({ sales: { stores: null, sellers: ["ana"] }, ownSellerId: "ana", collectStores: ["est_2"], showStores: false });
    expect(resolveStartScope(seller, stores, "est_1")).toMatchObject({ sales: { stores: ["est_1"], sellers: ["ana"] }, collectStores: ["est_1"], showStores: false });
    expect(() => resolveStartScope(seller, stores, "web")).toThrow(PosError);
  });
});

describe("resolveSubjectScope (?seller=)", () => {
  const stores = [{ id: "est_1", is_active: true }, { id: "est_2", is_active: true }];
  const admin = { is_admin: true, role: "owner" as const, establishment_ids: null, user_id: "boss", seller: null };
  const manager = { is_admin: false, role: "manager" as const, establishment_ids: ["est_1"], user_id: "mgr", seller: null };
  const ana = { is_admin: false, role: "seller" as const, establishment_ids: ["est_1"], user_id: "ana", seller: { id: "sel_ana", code: "ANA", active: true, establishment_id: "est_1", terminal_id: null } };
  const anaRow = { id: "sel_ana", code: "ANA", name: "Ana", user_id: "ana", establishment_id: "est_1", commission_pct: 10, active: true };
  const luisRow = { id: "sel_luis", code: "LUIS", name: "Luis", user_id: "luis", establishment_id: "est_2", commission_pct: 5, active: true };
  const referral = { id: "sel_ref", code: "REF", name: "Referidos", user_id: null, establishment_id: null, commission_pct: 5, active: true };

  it("admin: the seller's lines by code (counter and web alike), their open sales, no store lines", () => {
    expect(resolveSubjectScope(admin, stores, "", anaRow)).toEqual({ sales: { stores: null, sellers: null, sellerCodes: ["ANA"] }, pendingStores: null, ownSellerId: "ana", collectStores: null, showStores: false });
    expect(resolveSubjectScope(admin, stores, "est_2", anaRow)).toMatchObject({ sales: { stores: ["est_2"], sellerCodes: ["ANA"] }, pendingStores: ["est_2"], collectStores: ["est_2"] });
    // A referral-only seller has no panel user: no counter sale can be theirs.
    expect(resolveSubjectScope(admin, stores, "", referral)).toMatchObject({ ownSellerId: "-", sales: { sellerCodes: ["REF"] } });
  });

  it("manager: only a seller of a store they run, inside their stores", () => {
    expect(resolveSubjectScope(manager, stores, "", anaRow)).toMatchObject({ sales: { stores: ["est_1"], sellerCodes: ["ANA"] }, pendingStores: ["est_1"], ownSellerId: "ana", showStores: false });
    expect(() => resolveSubjectScope(manager, stores, "", luisRow)).toThrow(PosError);
    expect(() => resolveSubjectScope(manager, stores, "", referral)).toThrow(PosError);
  });

  it("seller: themselves and nobody else", () => {
    expect(resolveSubjectScope(ana, stores, "", anaRow)).toMatchObject({ sales: { stores: null, sellers: null, sellerCodes: ["ANA"] }, ownSellerId: "ana", showStores: false });
    expect(() => resolveSubjectScope(ana, stores, "", luisRow)).toThrow(PosError);
    expect(() => resolveSubjectScope(ana, stores, "", referral)).toThrow(PosError);
  });
});

describe("route allowlist", () => {
  it("lets every role read the start map", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/start-map?store=all")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/start-map")).toBe(false);
  });
});
