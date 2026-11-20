import { cleanShowcase, DEFAULT_SHOWCASE, MAX_SHOWCASE_BRANDS, showcaseOf } from "../src/lib/web-showcase";

const known = new Set(["di-caprio", "flexure", "trendy", "peachtree"]);

describe("«Vitrina de la tienda web»", () => {
  it("defaults to the catalogue order (as before)", () => {
    expect(DEFAULT_SHOWCASE).toEqual({ mode: "catalog", brands: [] });
    expect(showcaseOf(null)).toEqual({ mode: "catalog", brands: [] });
  });

  it("accepts the three modes", () => {
    expect(cleanShowcase({ mode: "catalog" }, known)).toEqual({ ok: true, value: { mode: "catalog", brands: [] } });
    expect(cleanShowcase({ mode: "brands", brands: ["flexure"] }, known)).toEqual({ ok: true, value: { mode: "brands", brands: ["flexure"] } });
    expect(cleanShowcase({ mode: "random", brands: [] }, known)).toEqual({ ok: true, value: { mode: "random", brands: [] } });
    expect(cleanShowcase({ mode: "random", brands: ["trendy", "flexure"] }, known)).toEqual({ ok: true, value: { mode: "random", brands: ["trendy", "flexure"] } });
  });

  it("keeps the owner's order and collapses duplicates", () => {
    const r = cleanShowcase({ mode: "brands", brands: ["trendy", "flexure", "trendy"] }, known);
    expect(r).toEqual({ ok: true, value: { mode: "brands", brands: ["trendy", "flexure"] } });
  });

  it("drops the brand list in catalogue mode", () => {
    expect(cleanShowcase({ mode: "catalog", brands: ["flexure"] }, known)).toEqual({ ok: true, value: { mode: "catalog", brands: [] } });
  });

  it("rejects what does not make sense instead of trimming it", () => {
    expect(cleanShowcase({ mode: "featured" })).toEqual({ ok: false, reason: "bad_mode" });
    expect(cleanShowcase({})).toEqual({ ok: false, reason: "bad_mode" });
    expect(cleanShowcase({ mode: "brands", brands: "flexure" })).toEqual({ ok: false, reason: "bad_brands" });
    expect(cleanShowcase({ mode: "brands", brands: ["Flexure!"] })).toEqual({ ok: false, reason: "bad_brands" });
    expect(cleanShowcase({ mode: "brands", brands: [3] })).toEqual({ ok: false, reason: "bad_brands" });
    expect(cleanShowcase({ mode: "brands", brands: [] }, known)).toEqual({ ok: false, reason: "brands_required" });
    expect(cleanShowcase({ mode: "brands", brands: ["gone"] }, known)).toEqual({ ok: false, reason: "unknown_brand" });
    const many = Array.from({ length: MAX_SHOWCASE_BRANDS + 1 }, (_, i) => `b${i}`);
    expect(cleanShowcase({ mode: "random", brands: many })).toEqual({ ok: false, reason: "too_many_brands" });
  });

  it("reads a stored row, and anything unreadable is the catalogue order", () => {
    expect(showcaseOf({ mode: "random", brands: ["flexure"] })).toEqual({ mode: "random", brands: ["flexure"] });
    expect(showcaseOf({ mode: "brands", brands: '["trendy"]' })).toEqual({ mode: "brands", brands: ["trendy"] });
    expect(showcaseOf({ mode: "brands", brands: [] })).toEqual({ mode: "catalog", brands: [] });
    expect(showcaseOf({ mode: "weird", brands: [] })).toEqual({ mode: "catalog", brands: [] });
    expect(showcaseOf({ mode: "random", brands: "{bad" })).toEqual({ mode: "random", brands: [] });
  });
});
