import { planOwnerPriceImport, type LensKnown } from "../src/lib/price-import";

const catalog = [
  { id: "prod_1", title: "B-1234 Classic" },
  { id: "prod_2", title: "Estuche Rígido" },
  { id: "prod_3", title: "Twin" },
  { id: "prod_4", title: "TWIN" },
];
const known: LensKnown = {
  base: new Set(["sv:cr39", "prog:poly"]),
  photo: new Set(["transitions"]),
  ar: new Set(["ar-basic", "ar-green"]),
};

describe("planOwnerPriceImport", () => {
  it("matches frames and cases by model name the way price-sync does", () => {
    const plan = planOwnerPriceImport(
      { frames: { "b1234 classic": 89 }, cases: { "Estuche Rígido": "12.5" } },
      catalog,
      known
    );
    expect(plan.products).toEqual([
      { scope: "frame", product_id: "prod_1", title: "B-1234 Classic", key: "b1234 classic", price: 89 },
      { scope: "case", product_id: "prod_2", title: "Estuche Rígido", key: "Estuche Rígido", price: 12.5 },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("reports unknown, ambiguous and invalid products instead of guessing", () => {
    const plan = planOwnerPriceImport({ frames: { Nope: 10, twin: 20, "B-1234 Classic": -3 } }, catalog, known);
    expect(plan.products).toEqual([]);
    expect(plan.skipped).toEqual([
      { group: "frames", key: "Nope", reason: "no_product" },
      { group: "frames", key: "twin", reason: "ambiguous_product" },
      { group: "frames", key: "B-1234 Classic", reason: "bad_price" },
    ]);
  });

  it("maps lens keys onto the matrix tables, in cents", () => {
    const plan = planOwnerPriceImport(
      { lens: { "b:sv:cr39": 45.5, "p:transitions:prog": 120, "a:ar-basic": 30 } },
      catalog,
      known
    );
    expect(plan.lens).toEqual({
      base: [{ design_code: "sv", material_code: "cr39", price_cents: 4550 }],
      photo: [{ code: "transitions", category: "prog", price_cents: 12000 }],
      ar: [{ code: "ar-basic", price_cents: 3000 }],
    });
  });

  it("does not flatten the AR Green/Blue matrix into one number", () => {
    const plan = planOwnerPriceImport({ lens: { "a:ar-green": 40 } }, catalog, known);
    expect(plan.lens.ar).toEqual([]);
    expect(plan.skipped).toEqual([{ group: "lens", key: "a:ar-green", reason: "matrix_priced" }]);
  });

  it("skips lens cells that do not exist and photo categories it does not know", () => {
    const plan = planOwnerPriceImport({ lens: { "b:sv:glass": 1, "p:transitions:trifocal": 1, "x:1": 1 } }, catalog, known);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["unknown_lens", "unknown_lens", "unknown_lens"]);
  });

  it("reports the pre-2026 lens groups and shipping without importing them", () => {
    const plan = planOwnerPriceImport(
      { materials: { poly: 10 }, treatments: { ar: 5 }, usage: { reading: 1 }, shipping: { fedexRate: 28 } },
      catalog,
      known
    );
    expect(plan.skipped).toEqual([
      { group: "materials", key: "poly", reason: "legacy_lens_model" },
      { group: "treatments", key: "ar", reason: "legacy_lens_model" },
      { group: "usage", key: "reading", reason: "legacy_lens_model" },
      { group: "shipping", key: "shipping", reason: "not_a_price_rule" },
    ]);
  });
});
