import {
  applyStoreLensToggles,
  indexOneStoreToggles,
  indexStoreLensToggles,
  isArEnabled,
  isDesignEnabled,
  isLensCellEnabled,
  isPhotoEnabled,
  storeLensToggleDenied,
  type StoreLensToggleRow,
} from "../src/lib/store-lens-toggle";
import { buildLensGroups, buildTreatmentGroups } from "../src/lib/price-matrix";

const sampleMatrix = () => ({
  designs: [
    { code: "sv", label_es: "Visión sencilla", label_en: "Single vision", category: "sv" },
    { code: "prog-mid", label_es: "Progresivo", label_en: "Progressive", category: "prog" },
  ],
  materials: [
    { code: "cr39", label_es: "CR-39", label_en: "CR-39" },
    { code: "poly", label_es: "Policarbonato", label_en: "Polycarbonate" },
  ],
  base_prices: [
    { design_code: "sv", material_code: "cr39", finish: "stock" as const, price_cents: 4000 },
    { design_code: "sv", material_code: "poly", finish: "stock" as const, price_cents: 6000 },
    { design_code: "sv", material_code: "poly", finish: "digital" as const, price_cents: 9000 },
    { design_code: "prog-mid", material_code: "poly", finish: "digital" as const, price_cents: 18000 },
  ],
  photos: [
    { code: "photo-grey", label_es: "Fotocromático Gris", label_en: "Photo Grey", price_sv_cents: 5000, price_bifocal_cents: 6000, price_prog_cents: 7000 },
  ],
  ars: [
    { code: "ar-green", label_es: "AR Verde", label_en: "AR Green", ar_group: "all", price_cents: 3000 },
    { code: "ar-blue", label_es: "AR Azul", label_en: "AR Blue", ar_group: "all", price_cents: 4500 },
  ],
  treatment_prices: [
    { design_code: "sv", material_code: "poly", treatment_code: "photo", price_cents: 5000 },
    { design_code: "sv", material_code: "poly", treatment_code: "ar-green", price_cents: 3000 },
    { design_code: "sv", material_code: "poly", treatment_code: "ar-blue", price_cents: 4500 },
  ],
});

describe("store-lens-toggle", () => {
  test("opt-out by default: empty toggles leave everything enabled and matrix untouched", () => {
    const m = sampleMatrix();
    const t = indexOneStoreToggles([]);
    expect(isDesignEnabled(t, "sv")).toBe(true);
    expect(isLensCellEnabled(t, "sv", "poly", "stock", "sv")).toBe(true);
    expect(isPhotoEnabled(t, "photo-grey", "sv")).toBe(true);
    expect(isArEnabled(t, "ar-blue")).toBe(true);
    expect(applyStoreLensToggles(m, t)).toBe(m);
  });

  test("disabling a lens design hides its cells and drops the design from that store only", () => {
    const rows: StoreLensToggleRow[] = [
      { establishment_id: "est_online", item_kind: "design", item_key: "prog-mid", enabled: false },
    ];
    const byStore = indexStoreLensToggles(rows);
    const online = applyStoreLensToggles(sampleMatrix(), byStore.get("est_online"));
    const physical = applyStoreLensToggles(sampleMatrix(), byStore.get("est_s1"));

    expect(online.designs.map((d) => d.code)).toEqual(["sv"]);
    expect(online.base_prices.some((c) => c.design_code === "prog-mid")).toBe(false);
    expect(physical.designs.map((d) => d.code)).toEqual(["sv", "prog-mid"]);
  });

  test("cell-level override wins over design-level toggle", () => {
    const t = indexOneStoreToggles([
      { establishment_id: "est_1", item_kind: "design", item_key: "sv", enabled: false },
      { establishment_id: "est_1", item_kind: "lens", item_key: "sv:poly", enabled: true },
    ]);
    const filtered = applyStoreLensToggles(sampleMatrix(), t);
    expect(filtered.designs.map((d) => d.code)).toEqual(["sv", "prog-mid"]);
    expect(filtered.base_prices.filter((c) => c.design_code === "sv").map((c) => `${c.material_code}:${c.finish}`)).toEqual(["poly:stock"]);
  });

  test("disabling photochromic per category and AR per option filters matrix and treatment_prices", () => {
    const t = indexOneStoreToggles([
      { establishment_id: "est_1", item_kind: "photo", item_key: "photo-grey:sv", enabled: false },
      { establishment_id: "est_1", item_kind: "ar", item_key: "ar-blue", enabled: false },
    ]);
    const filtered = applyStoreLensToggles(sampleMatrix(), t);
    expect(filtered.photos).toHaveLength(1);
    expect(filtered.photos[0].price_sv_cents).toBeNull();
    expect(filtered.photos[0].price_prog_cents).toBe(7000);
    expect(filtered.ars.map((a) => a.code)).toEqual(["ar-green"]);
    expect(filtered.treatment_prices.map((tp) => tp.treatment_code)).toEqual(["ar-green"]);
  });

  test("treatment_group disables entire family in that store", () => {
    const t = indexOneStoreToggles([
      { establishment_id: "est_1", item_kind: "treatment_group", item_key: "photo", enabled: false },
      { establishment_id: "est_1", item_kind: "treatment_group", item_key: "ar", enabled: false },
    ]);
    const filtered = applyStoreLensToggles(sampleMatrix(), t);
    expect(filtered.photos).toEqual([]);
    expect(filtered.ars).toEqual([]);
    expect(filtered.treatment_prices).toEqual([]);
  });

  test("buildLensGroups and buildTreatmentGroups expose per-store switches while keeping global switch and costs intact", () => {
    const stores = [
      { id: "est_1", code: "S1", name: "Store 1", color: "#111" },
      { id: "est_online", code: "WEB", name: "Online", color: "#222" },
    ];
    const toggles = indexStoreLensToggles([
      { establishment_id: "est_online", item_kind: "lens", item_key: "sv:poly", enabled: false },
      { establishment_id: "est_online", item_kind: "ar", item_key: "ar-blue", enabled: false },
    ]);

    const lensGroups = buildLensGroups(
      {
        designs: [{ code: "sv", label_es: "Visión sencilla", label_en: "Single vision", category: "sv" }],
        materials: [
          { code: "cr39", label_es: "CR-39", label_en: "CR-39" },
          { code: "poly", label_es: "Policarbonato", label_en: "Polycarbonate" },
        ],
        cells: [
          { design_code: "sv", material_code: "cr39", finish: "stock", price_cents: 4000, cost_cents: 1200, active: false },
          { design_code: "sv", material_code: "poly", finish: "stock", price_cents: 6000, cost_cents: 1800, active: true },
        ],
        storeRows: new Map(),
        storeToggles: toggles,
      },
      stores,
      new Map(),
      true
    );

    const cr39 = lensGroups[0].rows.find((r) => r.key === "sv:cr39")!;
    const poly = lensGroups[0].rows.find((r) => r.key === "sv:poly")!;
    // Global active:false forces exposed:false in every store while preserving cost
    expect(cr39.active).toBe(false);
    expect(cr39.cost_cents).toBe(1200);
    expect(cr39.stores.est_1.exposed).toBe(false);
    expect(cr39.stores.est_online.exposed).toBe(false);
    // Per-store toggle affects only est_online; cost stays identical
    expect(poly.cost_cents).toBe(1800);
    expect(poly.stores.est_1.exposed).toBe(true);
    expect(poly.stores.est_online.exposed).toBe(false);

    const treatGroups = buildTreatmentGroups(
      {
        photos: sampleMatrix().photos,
        ars: sampleMatrix().ars,
        photoCosts: new Map([["photo-grey:sv", 1500]]),
        arCosts: new Map([["ar-blue", 900]]),
        storeRows: new Map(),
        storeToggles: toggles,
        photoByMaterial: false,
      },
      stores,
      new Map(),
      true
    );
    const arBlue = treatGroups[1].rows.find((r) => r.key === "ar-blue")!;
    expect(arBlue.cost_cents).toBe(900);
    expect(arBlue.stores.est_1.exposed).toBe(true);
    expect(arBlue.stores.est_online.exposed).toBe(false);
  });

  test("storeLensToggleDenied validates inputs", () => {
    expect(storeLensToggleDenied({ store: "est_1", kind: "lens", key: "sv:poly", enabled: false })).toBeNull();
    expect(storeLensToggleDenied({ store: "est_1", kind: "treatment_group", key: "photo", enabled: true })).toBeNull();
    expect(storeLensToggleDenied({ store: "", kind: "lens", key: "sv:poly", enabled: false })).toBe("store_required");
    expect(storeLensToggleDenied({ store: "est_1", kind: "other", key: "x", enabled: false })).toBe("bad_kind");
    expect(storeLensToggleDenied({ store: "est_1", kind: "treatment_group", key: "other", enabled: false })).toBe("bad_key");
    expect(storeLensToggleDenied({ store: "est_1", kind: "ar", key: "ar-blue", enabled: "yes" })).toBe("bad_value");
  });
});
