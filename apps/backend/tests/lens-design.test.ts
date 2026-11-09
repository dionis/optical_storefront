/** Lens designs managed from «Productos y precios» → Lentes (docs/PRICE-MATRIX.md §12). */
import { cleanLensCell, cleanLensDesign, cleanLensDesignPatch, deriveLensCode, moneyCents } from "../src/lib/lens-design";

describe("lens designs", () => {
  it("validates a new design and defaults the ADD by category", () => {
    expect(cleanLensDesign({ label_es: "Progresivo Elite", category: "prog" })).toEqual({
      design: { label_es: "Progresivo Elite", label_en: "Progresivo Elite", category: "prog", code: null, requires_add: true, tier: null, use_es: null, use_en: null },
    });
    expect((cleanLensDesign({ label_en: "Reading", category: "sv" }) as { design: { requires_add: boolean } }).design.requires_add).toBe(false);
    expect(cleanLensDesign({ label_es: "", category: "sv" })).toEqual({ reason: "bad_label" });
    expect(cleanLensDesign({ label_es: "X", category: "contact" })).toEqual({ reason: "bad_category" });
    expect(cleanLensDesign({ label_es: "X", category: "sv", code: "Bad Code!" })).toEqual({ reason: "bad_value" });
    expect(cleanLensDesign({ label_es: "X", category: "sv", tier: "x".repeat(41) })).toEqual({ reason: "bad_value" });
  });

  it("edits only what is sent and never the category", () => {
    expect(cleanLensDesignPatch({ label_es: "Bifocal FT-35", tier: "" })).toEqual({ patch: { label_es: "Bifocal FT-35", tier: null } });
    expect(cleanLensDesignPatch({ category: "prog" })).toEqual({ reason: "bad_category" });
    expect(cleanLensDesignPatch({})).toEqual({ reason: "nothing_to_change" });
    expect(cleanLensDesignPatch({ requires_add: "yes" })).toEqual({ reason: "bad_value" });
  });

  it("derives a free code from the label", () => {
    expect(deriveLensCode("Progresivo Gama Alta", new Set())).toBe("progresivo-gama-alta");
    expect(deriveLensCode("Índice 1.60", new Set(["indice-1.60"]))).toBe("indice-1.60-2");
  });

  it("validates a cell: existing or new material, finish rules, price required", () => {
    expect(cleanLensCell({ material_code: "poly", price: "95", cost: "30" }, "sv")).toEqual({ cell: { material: { code: "poly" }, finish: "stock", price_cents: 9500, cost_cents: 3000 } });
    expect(cleanLensCell({ material_code: "poly", price: 180 }, "prog")).toMatchObject({ cell: { finish: "digital", cost_cents: null } });
    expect(cleanLensCell({ material_code: "poly", finish: "stock", price: 180 }, "prog")).toEqual({ reason: "finish_unavailable" });
    expect(cleanLensCell({ new_material: { label_es: "Trivex", max_abs: "8" }, price: 120 }, "sv")).toMatchObject({ cell: { material: { label_es: "Trivex", label_en: "Trivex", max_abs: 8 } } });
    expect(cleanLensCell({ material_code: "poly" }, "sv")).toEqual({ reason: "bad_value" });
    expect(cleanLensCell({ price: 10 }, "sv")).toEqual({ reason: "bad_material" });
    expect(moneyCents("$1,234.50")).toBe(123450);
    expect(moneyCents("-1")).toBeUndefined();
  });
});
