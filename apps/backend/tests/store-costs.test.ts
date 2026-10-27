import { allocateShared, cleanCostItem, computePnl, monthlyCharge, type CostItemLike } from "../src/lib/store-costs";
import { expectedCash } from "../src/lib/cash";

const item = (o: Partial<CostItemLike>): CostItemLike => ({
  establishment_id: "est_2",
  kind: "fixed",
  amount_cents: 120000,
  frequency: "monthly",
  amortize_months: null,
  starts_on: "2026-01-01",
  ends_on: null,
  allocation: null,
  ...o,
});

describe("monthlyCharge", () => {
  it("by frequency, inside its validity", () => {
    expect(monthlyCharge(item({}), "2026-10")).toBe(120000);
    expect(monthlyCharge(item({ frequency: "quarterly" }), "2026-10")).toBe(40000);
    expect(monthlyCharge(item({ frequency: "annual" }), "2026-10")).toBe(10000);
    expect(monthlyCharge(item({ starts_on: "2026-11-01" }), "2026-10")).toBe(0);
    expect(monthlyCharge(item({ ends_on: "2026-09-30" }), "2026-10")).toBe(0);
  });

  it("a one-time item, at once or spread over months (equipment)", () => {
    expect(monthlyCharge(item({ frequency: "one_time", starts_on: "2026-10-15" }), "2026-10")).toBe(120000);
    expect(monthlyCharge(item({ frequency: "one_time", starts_on: "2026-10-15" }), "2026-11")).toBe(0);
    const spread = item({ frequency: "one_time", amortize_months: 12, starts_on: "2026-01-01" });
    expect(monthlyCharge(spread, "2026-12")).toBe(10000);
    expect(monthlyCharge(spread, "2027-01")).toBe(0);
  });
});

describe("allocateShared (HU-95)", () => {
  it("by fixed percentages, adding up exactly", () => {
    const r = allocateShared(31000, { method: "percent", shares: { a: 50, b: 30, c: 20 } }, ["a", "b", "c"], new Map());
    expect([...r.values()]).toEqual([15500, 9300, 6200]);
  });

  it("in proportion to sales, equal when nothing sold", () => {
    const r = allocateShared(1000, { method: "sales" }, ["a", "b"], new Map([["a", 300], ["b", 100]]));
    expect([r.get("a"), r.get("b")]).toEqual([750, 250]);
    const e = allocateShared(1001, { method: "sales" }, ["a", "b"], new Map());
    expect((e.get("a") ?? 0) + (e.get("b") ?? 0)).toBe(1001);
  });
});

describe("computePnl (HU-96)", () => {
  it("reproduces the document's example", () => {
    const p = computePnl({ net_sales: 845000, cogs: 312000, payment_fees: 30000, commissions: 30000, variable_manual: 14200, fixed: 290000, shared: 31000 });
    expect(p.contribution).toBe(458800);
    expect(p.result).toBe(137800);
    expect(p.contribution_pct).toBe(54.3);
    // 3,210 ÷ 54.3 % ≈ 5,912 (document); exact division of the cents
    expect(Math.round((p.break_even ?? 0) / 100)).toBe(5912);
  });

  it("no break-even without a positive margin", () => {
    expect(computePnl({ net_sales: 0, cogs: 0, payment_fees: 0, commissions: 0, variable_manual: 0, fixed: 1000, shared: 0 }).break_even).toBeNull();
  });
});

describe("cleanCostItem", () => {
  const stores = ["est_1", "est_2"];
  it("a shared cost needs shares that add up to 100", () => {
    expect(cleanCostItem({ kind: "fixed", category: "accounting", amount: 310, frequency: "monthly", starts_on: "2026-01-01", allocation: { method: "percent", shares: { est_1: 60, est_2: 30 } } }, stores)).toEqual({ reason: "bad_allocation" });
    const ok = cleanCostItem({ kind: "fixed", category: "accounting", amount: 310, frequency: "monthly", starts_on: "2026-01-01", allocation: { method: "sales" } }, stores);
    expect("item" in ok && ok.item).toMatchObject({ establishment_id: null, amount_cents: 31000, allocation: { method: "sales" } });
  });
  it("refuses unknown categories and reversed dates", () => {
    expect(cleanCostItem({ establishment_id: "est_2", kind: "fixed", category: "x", amount: 1, starts_on: "2026-01-01" }, stores)).toEqual({ reason: "bad_category" });
    expect(cleanCostItem({ establishment_id: "est_2", kind: "fixed", category: "rent", amount: 1, starts_on: "2026-02-01", ends_on: "2026-01-01" }, stores)).toEqual({ reason: "bad_date" });
  });
});

describe("expectedCash (HU-32)", () => {
  it("opening + cash payments (refunds negative) + in − out", () => {
    expect(expectedCash(10000, [5000, -2000], [{ kind: "in", amount: 1000 }, { kind: "out", amount: 3000 }])).toBe(11000);
  });
});
