import { assortmentRuleDenied, brandExposed, brandOf, exposureSource, isExposed, type AssortmentRuleLike } from "../src/lib/store-assortment";

const brandRule = (target: string, exposed: boolean): AssortmentRuleLike => ({ scope: "brand", target, exposed });
const modelRule = (target: string, exposed: boolean): AssortmentRuleLike => ({ scope: "product", target, exposed });
const dc = { id: "prod_1", brand: "di-caprio" };

describe("isExposed", () => {
  it("a new store (no rules) exposes the whole catalog", () => {
    expect(isExposed([], dc)).toBe(true);
    expect(isExposed([], { id: "prod_x", brand: "" })).toBe(true);
  });

  it("a hidden brand hides its models, including ones added later", () => {
    const rules = [brandRule("di-caprio", false)];
    expect(isExposed(rules, dc)).toBe(false);
    expect(isExposed(rules, { id: "prod_new", brand: "di-caprio" })).toBe(false);
    expect(isExposed(rules, { id: "prod_2", brand: "flexure" })).toBe(true);
  });

  it("a model rule beats its brand rule, both ways", () => {
    expect(isExposed([brandRule("di-caprio", false), modelRule("prod_1", true)], dc)).toBe(true);
    expect(isExposed([brandRule("di-caprio", true), modelRule("prod_1", false)], dc)).toBe(false);
    expect(isExposed([modelRule("prod_1", false)], dc)).toBe(false);
  });

  it("a rule of another store's model does not leak", () => {
    expect(isExposed([modelRule("prod_9", false)], dc)).toBe(true);
  });
});

describe("brandExposed / brandOf", () => {
  it("brand inherits exposed when it has no rule", () => {
    expect(brandExposed([], "trendy")).toBe(true);
    expect(brandExposed([brandRule("trendy", false)], "trendy")).toBe(false);
  });

  it("reads brand_slug, then collection_slug, lowercased", () => {
    expect(brandOf({ brand_slug: "Di-Caprio" })).toBe("di-caprio");
    expect(brandOf({ collection_slug: "case" })).toBe("case");
    expect(brandOf(null)).toBe("");
  });
});

describe("assortmentRuleDenied", () => {
  it("accepts brand/product with true, false or null (remove)", () => {
    expect(assortmentRuleDenied("brand", "4u", false)).toBeNull();
    expect(assortmentRuleDenied("product", "prod_1", true)).toBeNull();
    expect(assortmentRuleDenied("product", "prod_1", null)).toBeNull();
  });

  it("rejects bad scope, target or value", () => {
    expect(assortmentRuleDenied("all", "x", true)).toBe("bad_scope");
    expect(assortmentRuleDenied("brand", "  ", true)).toBe("bad_target");
    expect(assortmentRuleDenied("brand", 5, true)).toBe("bad_target");
    expect(assortmentRuleDenied("brand", "4u", "yes")).toBe("bad_exposed");
  });
});

describe("exposureSource", () => {
  it("names the rule that decides the model", () => {
    expect(exposureSource([], dc)).toBe("default");
    expect(exposureSource([brandRule("di-caprio", false)], dc)).toBe("brand");
    expect(exposureSource([brandRule("di-caprio", false), modelRule("prod_1", true)], dc)).toBe("product");
    expect(exposureSource([brandRule("flexure", false)], dc)).toBe("default");
  });
});
