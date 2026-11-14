import { costMultipleDenied, costMultiplePrice, planCostMultiple, COST_MULTIPLE_SOURCE } from "../src/lib/cost-multiple";
import { RULE_MODES } from "../src/lib/store-pricing";

const frame = (id: string, cost: number | null) => ({ product_id: id, is_case: false, cost_cents: cost });
const derived = (id: string, target: string, value: number) => ({ id, target, value, source: COST_MULTIPLE_SOURCE });
const typed = (id: string, target: string, value: number) => ({ id, target, value, source: "price-matrix" });

describe("«N veces el costo»: a store's frame rule", () => {
  it("is a rule mode of its own", () => {
    expect(RULE_MODES).toContain("cost_multiple");
  });

  it("accepts a multiple between 1 and 20 and nothing else", () => {
    expect(costMultipleDenied(3)).toBeNull();
    expect(costMultipleDenied("2.5")).toBeNull();
    expect(costMultipleDenied(1)).toBeNull();
    expect(costMultipleDenied(20)).toBeNull();
    for (const bad of [0, 0.99, 20.01, -3, "x", null, undefined, Number.NaN]) expect(costMultipleDenied(bad)).toBe("bad_value");
  });

  it("prices to the cent", () => {
    expect(costMultiplePrice(2500, 3)).toBe(75);
    expect(costMultiplePrice(1833, 3)).toBe(54.99);
    expect(costMultiplePrice(1999, 2.5)).toBe(49.98);
  });

  it("writes cost × N for every frame with a cost", () => {
    const plan = planCostMultiple(3, [frame("a", 2500), frame("b", 1000)], []);
    expect(plan.set).toEqual([{ product_id: "a", price: 75 }, { product_id: "b", price: 30 }]);
    expect(plan.close).toEqual([]);
    expect(plan).toMatchObject({ applied: 2, no_cost: 0, kept_own: 0 });
  });

  it("leaves alone a frame with no cost, a case and a price the owner typed", () => {
    const plan = planCostMultiple(
      3,
      [frame("a", 2500), frame("nocost", null), frame("zero", 0), { product_id: "case", is_case: true, cost_cents: 500 }, frame("mine", 4000)],
      [typed("r1", "mine", 99)]
    );
    expect(plan.set).toEqual([{ product_id: "a", price: 75 }]);
    expect(plan.close).toEqual([]);
    expect(plan).toMatchObject({ applied: 1, no_cost: 2, kept_own: 1 });
  });

  it("writes nothing when the prices already match (the 4-hourly pass is idempotent)", () => {
    const plan = planCostMultiple(3, [frame("a", 2500), frame("b", 1833)], [derived("r1", "a", 75), derived("r2", "b", 54.99)]);
    expect(plan.set).toEqual([]);
    expect(plan.close).toEqual([]);
    expect(plan.applied).toBe(2);
  });

  it("replaces the derived price when the cost or the multiple changes", () => {
    const byCost = planCostMultiple(3, [frame("a", 3000)], [derived("r1", "a", 75)]);
    expect(byCost.set).toEqual([{ product_id: "a", price: 90 }]);
    expect(byCost.close).toEqual(["r1"]);
    const byRule = planCostMultiple(2, [frame("a", 2500)], [derived("r1", "a", 75)]);
    expect(byRule.set).toEqual([{ product_id: "a", price: 50 }]);
    expect(byRule.close).toEqual(["r1"]);
  });

  it("closes a derived price whose model lost its cost or left the catalogue", () => {
    const plan = planCostMultiple(3, [frame("a", null)], [derived("r1", "a", 75), derived("r2", "gone", 60)]);
    expect(plan.set).toEqual([]);
    expect(plan.close.sort()).toEqual(["r1", "r2"]);
    expect(plan.no_cost).toBe(1);
  });

  it("closes the derived price once the owner types his own", () => {
    const plan = planCostMultiple(3, [frame("a", 2500)], [derived("r1", "a", 75), typed("r2", "a", 120)]);
    expect(plan.set).toEqual([]);
    expect(plan.close).toEqual(["r1"]);
    expect(plan.kept_own).toBe(1);
  });

  it("collapses duplicate derived rows into one", () => {
    const plan = planCostMultiple(3, [frame("a", 2500)], [derived("r1", "a", 75), derived("r2", "a", 75)]);
    expect(plan.close.sort()).toEqual(["r1", "r2"]);
    expect(plan.set).toEqual([{ product_id: "a", price: 75 }]);
  });

  it("removing the rule removes every derived price and no typed one", () => {
    const plan = planCostMultiple(null, [frame("a", 2500)], [derived("r1", "a", 75), derived("r2", "b", 30), typed("r3", "c", 99)]);
    expect(plan.set).toEqual([]);
    expect(plan.close.sort()).toEqual(["r1", "r2"]);
    expect(plan.applied).toBe(0);
  });
});
