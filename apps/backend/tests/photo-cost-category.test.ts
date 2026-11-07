/**
 * A photochromic's lab cost per design category (7-nov-2026): single vision,
 * bifocal and progressive each have their own cost, like their own price.
 */
import { writeLensMaster } from "../src/lib/lens-price-write";
import { photoCostIndex } from "../src/lib/price-matrix-data";
import { buildTreatmentGroups, cleanTreatment, cleanTreatmentPatch, photoCostsOf } from "../src/lib/price-matrix";
import { indexItemDiscounts } from "../src/lib/price-matrix";

describe("photochromic cost per category", () => {
  it("indexes each category's own cost, falling back to the old single cost", () => {
    const idx = photoCostIndex([
      { code: "photo-grey", cost_cents: 900, cost_sv_cents: 900, cost_bifocal_cents: 1500, cost_prog_cents: null },
      { code: "photo-old", cost_cents: 700 },
    ]);
    expect(idx.get("photo-grey:sv")).toBe(900);
    expect(idx.get("photo-grey:bifocal")).toBe(1500);
    expect(idx.get("photo-grey:prog")).toBe(900); // no own cost yet: the single one
    expect(idx.get("photo-old:prog")).toBe(700); // a database before the columns
    expect(idx.get("photo-grey")).toBe(900);
  });

  it("each matrix row shows its category's cost", () => {
    const [photo] = buildTreatmentGroups(
      {
        photos: [{ code: "photo-grey", label_es: "Grey", label_en: "Grey", price_sv_cents: 3000, price_bifocal_cents: 4000, price_prog_cents: 5000 }],
        ars: [],
        photoCosts: new Map([["photo-grey", 900], ["photo-grey:sv", 900], ["photo-grey:bifocal", 1500], ["photo-grey:prog", 2100]]),
        arCosts: new Map(),
        storeRows: new Map(),
        photoByMaterial: false,
      },
      [],
      indexItemDiscounts([]),
      true
    );
    expect(photo.rows.map((r) => [r.key, r.master_cents, r.cost_cents])).toEqual([
      ["photo-grey:sv", 3000, 900],
      ["photo-grey:bifocal", 4000, 1500],
      ["photo-grey:prog", 5000, 2100],
    ]);
  });

  it("validates costs per category on create and edit", () => {
    expect(photoCostsOf({ sv: 9, bifocal: "15.5", prog: "" }, false)).toEqual({ costs: { sv: 900, bifocal: 1550, prog: null } });
    expect(photoCostsOf({ tint: 3 }, false)).toEqual({ reason: "bad_value" });
    expect(photoCostsOf({}, true)).toEqual({ reason: "bad_value" });
    const made = cleanTreatment({ type: "photo", label_es: "Gris", prices: { sv: 30, bifocal: 40, prog: null }, costs: { sv: 9, bifocal: 15 } });
    expect(made).toMatchObject({ treatment: { costs: { sv: 900, bifocal: 1500, prog: null }, prices: { sv: 3000, bifocal: 4000, prog: null } } });
    // Without `costs` the old single cost still works (it then applies to every category).
    expect("costs" in (cleanTreatment({ type: "photo", label_es: "Gris", prices: { sv: 30 }, cost: 9 }) as { treatment: object }).treatment).toBe(false);
    expect(cleanTreatmentPatch("photo", { costs: { prog: 21 } })).toEqual({ patch: { costs: { prog: 2100 } } });
    expect(cleanTreatmentPatch("ar", { costs: { sv: 1 } })).toEqual({ reason: "bad_value" });
  });

  it("the cell writer writes the category's own cost column; without a category, all of them", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const svc = {
      listLensPhotoOptions: jest.fn(async () => [{ id: "lpo_1", code: "photo-grey", deleted_at: null }]),
      updateLensPhotoOptions: jest.fn(async (rows: Array<Record<string, unknown>>) => { updates.push(...rows); }),
    };
    const container = { resolve: () => svc } as never;
    expect(await writeLensMaster(container, "photo", "photo-grey:bifocal", "cost", 1500)).toBeNull();
    expect(await writeLensMaster(container, "photo", "photo-grey:prog", "price", 5000)).toBeNull();
    expect(await writeLensMaster(container, "photo", "photo-grey", "cost", 900)).toBeNull();
    expect(await writeLensMaster(container, "photo", "photo-grey", "price", 900)).toBe("bad_key");
    expect(await writeLensMaster(container, "photo", "photo-grey:tint", "cost", 900)).toBe("bad_key");
    expect(updates).toEqual([
      { id: "lpo_1", cost_bifocal_cents: 1500 },
      { id: "lpo_1", price_prog_cents: 5000 },
      { id: "lpo_1", cost_cents: 900, cost_sv_cents: 900, cost_bifocal_cents: 900, cost_prog_cents: 900 },
    ]);
  });
});
