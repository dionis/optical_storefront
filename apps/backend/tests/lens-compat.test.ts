/**
 * Unit tests for the legacy → 2026-matrix lens compatibility layer.
 *
 * Pricing is the thing that must never be wrong, so these cover the resolution rules
 * (usage_type → design, index → material, coating type → concrete option) and assert
 * the resulting cents against the seeded 2026 price list.
 *
 * Knex is stubbed: the layer only ever chains .whereNull().where().orderBy() and
 * awaits the result, so a small in-memory filter reproduces it faithfully without a
 * database — matching the "no live I/O in CI" convention.
 */
import type { Knex } from "@mikro-orm/knex";
import {
  listCompatCoatingOptions,
  listCompatLensOptions,
  refractiveIndexOf,
  resolveLegacySelection,
  LensCompatError,
} from "../src/lib/lens-compat";
import { computeLensBreakdown } from "../src/lib/lens-quote";

// ── Fixtures: the rows SeedLens2026Data3 puts in the database ────────────────

const c = (usd: number | null): number | null => (usd == null ? null : usd * 100);

const DESIGNS = [
  { code: "sv", category: "sv", label_es: "Visión Sencilla", label_en: "Single Vision", requires_rx: true, requires_add: false, sort: 0, is_active: true, deleted_at: null },
  { code: "bifocal", category: "bifocal", label_es: "Bifocal FT-28", label_en: "Bifocal FT-28", requires_rx: true, requires_add: true, sort: 1, is_active: true, deleted_at: null },
  { code: "prog-mid", category: "prog", label_es: "Progresivo Gama Media", label_en: "Progressive · Mid", requires_rx: true, requires_add: true, sort: 2, is_active: true, deleted_at: null },
  { code: "prog-high", category: "prog", label_es: "Progresivo Gama Alta", label_en: "Progressive · Premium", requires_rx: true, requires_add: true, sort: 3, is_active: true, deleted_at: null },
];

const MATERIALS = [
  { code: "cr39", label_es: "CR-39 (Resina)", label_en: "CR-39 (Resin)", desc_es: "Estándar, económico.", desc_en: "Standard, budget.", max_abs: 2, sort: 0, is_active: true, deleted_at: null },
  { code: "poly", label_es: "Policarbonato", label_en: "Polycarbonate", desc_es: "Resistente a impactos.", desc_en: "Impact-resistant.", max_abs: 3, sort: 1, is_active: true, deleted_at: null },
  { code: "1.56", label_es: "Índice 1.56", label_en: "Index 1.56", desc_es: "Más delgado.", desc_en: "Thinner.", max_abs: 3, sort: 2, is_active: true, deleted_at: null },
  { code: "1.61", label_es: "Índice 1.61", label_en: "Index 1.61", desc_es: "Delgado.", desc_en: "Thin.", max_abs: 4, sort: 3, is_active: true, deleted_at: null },
  { code: "1.67", label_es: "Índice 1.67", label_en: "Index 1.67", desc_es: "Muy delgado.", desc_en: "Very thin.", max_abs: 6, sort: 4, is_active: true, deleted_at: null },
  { code: "1.74", label_es: "Índice 1.74", label_en: "Index 1.74", desc_es: "Ultra delgado.", desc_en: "Ultra-thin.", max_abs: 99, sort: 5, is_active: true, deleted_at: null },
];

const BASE_USD: Record<string, Record<string, number>> = {
  "sv": { cr39: 60, poly: 90, "1.56": 100, "1.61": 100, "1.67": 120, "1.74": 150 },
  "bifocal": { cr39: 130, poly: 140, "1.56": 140, "1.61": 140, "1.67": 160, "1.74": 160 },
  "prog-mid": { cr39: 180, poly: 180, "1.56": 180, "1.61": 180, "1.67": 200, "1.74": 230 },
  "prog-high": { cr39: 240, poly: 240, "1.56": 240, "1.61": 240, "1.67": 280, "1.74": 300 },
};

const BASE_PRICES = Object.entries(BASE_USD).flatMap(([design_code, row]) =>
  Object.entries(row).map(([material_code, usd]) => ({
    design_code,
    material_code,
    price_cents: usd * 100,
    deleted_at: null,
  }))
);

const PHOTOS = [
  { code: "photo-grey", label_es: "Fotocromático Grey", label_en: "Photochromic Grey", colors: ["grey"], price_sv_cents: c(85), price_bifocal_cents: c(110), price_prog_cents: c(90), sort: 0, is_active: true, deleted_at: null },
  { code: "photo-brown", label_es: "Fotocromático Brown", label_en: "Photochromic Brown", colors: ["brown"], price_sv_cents: c(null), price_bifocal_cents: c(110), price_prog_cents: c(90), sort: 1, is_active: true, deleted_at: null },
  { code: "trans-s-grey", label_es: "Transitions Gen S Grey", label_en: "Transitions Gen S Grey", colors: ["grey"], price_sv_cents: c(105), price_bifocal_cents: c(105), price_prog_cents: c(105), sort: 2, is_active: true, deleted_at: null },
  { code: "trans-x-grey", label_es: "Transitions Xtractive Grey", label_en: "Transitions Xtractive Grey", colors: ["grey"], price_sv_cents: c(130), price_bifocal_cents: c(130), price_prog_cents: c(130), sort: 5, is_active: true, deleted_at: null },
];

const ARS = [
  { code: "ar-green-basic", label_es: "AR Green Básico", label_en: "AR Green Basic", ar_group: "sv", price_cents: 6000, sort: 0, is_active: true, deleted_at: null },
  { code: "ar-green-plus", label_es: "AR Green Plus", label_en: "AR Green Plus", ar_group: "sv", price_cents: 9000, sort: 1, is_active: true, deleted_at: null },
  { code: "ar-blue-protect", label_es: "AR Blue Protect", label_en: "AR Blue Protect", ar_group: "sv", price_cents: 9000, sort: 2, is_active: true, deleted_at: null },
  { code: "adequate", label_es: "Adequate", label_en: "Adequate", ar_group: "bifprog", price_cents: 5000, sort: 3, is_active: true, deleted_at: null },
  { code: "crystal", label_es: "Crystal", label_en: "Crystal", ar_group: "bifprog", price_cents: 8000, sort: 4, is_active: true, deleted_at: null },
  { code: "flawless", label_es: "Flawless", label_en: "Flawless", ar_group: "bifprog", price_cents: 12000, sort: 5, is_active: true, deleted_at: null },
  { code: "blue-uv-445", label_es: "Blue UV 445", label_en: "Blue UV 445", ar_group: "bifprog", price_cents: 12000, sort: 6, is_active: true, deleted_at: null },
];

type Row = Record<string, unknown>;

const TABLES: Record<string, Row[]> = {
  lens_design: DESIGNS,
  lens_material: MATERIALS,
  lens_base_price: BASE_PRICES,
  lens_photo_option: PHOTOS,
  lens_ar_option: ARS,
};

/** Minimal chainable Knex stand-in over the fixtures above. */
function makeKnex(tables: Record<string, Row[]> = TABLES): Knex {
  const build = (rows: Row[]) => {
    const state = { rows: [...rows] };
    const builder: Record<string, unknown> = {
      whereNull(col: string) {
        state.rows = state.rows.filter((r) => r[col] == null);
        return builder;
      },
      where(filters: Row) {
        state.rows = state.rows.filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v)
        );
        return builder;
      },
      orderBy(col: string, dir: "asc" | "desc") {
        const sign = dir === "desc" ? -1 : 1;
        state.rows.sort((a, b) => sign * (Number(a[col]) - Number(b[col])));
        return builder;
      },
      then(resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(state.rows).then(resolve, reject);
      },
    };
    return builder;
  };
  const fn = (table: string) => {
    if (!(table in tables)) throw new Error(`relation "${table}" does not exist`);
    return build(tables[table] as Row[]);
  };
  return fn as unknown as Knex;
}

const pg = makeKnex();

// ── refractive index ─────────────────────────────────────────────────────────

describe("refractiveIndexOf", () => {
  it("maps named materials to their real optical index", () => {
    expect(refractiveIndexOf("cr39")).toBe(1.5);
    expect(refractiveIndexOf("poly")).toBe(1.59);
  });

  it("reads numeric material codes as the index itself", () => {
    expect(refractiveIndexOf("1.56")).toBe(1.56);
    expect(refractiveIndexOf("1.74")).toBe(1.74);
  });

  it("returns 0 for an unknown, non-numeric code", () => {
    expect(refractiveIndexOf("mystery")).toBe(0);
  });
});

// ── GET /options ─────────────────────────────────────────────────────────────

describe("listCompatLensOptions", () => {
  it("returns one row per priced (design, material) cell", async () => {
    const options = await listCompatLensOptions(pg);
    expect(options).toHaveLength(BASE_PRICES.length); // 4 designs × 6 materials
  });

  it("prices each row from the matrix, in cents", async () => {
    const options = await listCompatLensOptions(pg);
    const svCr39 = options.find((o) => o.id === "sv:cr39");
    expect(svCr39?.price_modifier_cents).toBe(6000); // $60
    const progHigh174 = options.find((o) => o.id === "prog-high:1.74");
    expect(progHigh174?.price_modifier_cents).toBe(30000); // $300
  });

  it("carries the matrix codes alongside the legacy fields", async () => {
    const [first] = await listCompatLensOptions(pg, "single_vision_distance");
    expect(first).toMatchObject({
      design_code: "sv",
      material_code: "cr39",
      usage_type: "single_vision_distance",
      index: 1.5,
      is_active: true,
    });
    expect(first.label).toContain("Visión Sencilla");
  });

  it("serves single vision for distance, reading and plano alike", async () => {
    for (const usage of ["single_vision_distance", "single_vision_reading", "non_prescription"]) {
      const options = await listCompatLensOptions(pg, usage);
      expect(options).toHaveLength(6);
      expect(new Set(options.map((o) => o.design_code))).toEqual(new Set(["sv"]));
    }
  });

  it("returns both progressive tiers for usage_type=progressive", async () => {
    const options = await listCompatLensOptions(pg, "progressive");
    expect(new Set(options.map((o) => o.design_code))).toEqual(
      new Set(["prog-mid", "prog-high"])
    );
    expect(options).toHaveLength(12);
  });

  it("keeps ids unique even where (usage_type, index) repeats", async () => {
    const options = await listCompatLensOptions(pg, "progressive");
    const duplicated = options.filter((o) => o.index === 1.67);
    expect(duplicated).toHaveLength(2); // prog-mid and prog-high
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
  });

  it("exposes bifocal, which the legacy usage_type enum had no slot for", async () => {
    const options = await listCompatLensOptions(pg, "bifocal");
    expect(new Set(options.map((o) => o.design_code))).toEqual(new Set(["bifocal"]));
  });

  it("returns an empty list rather than throwing when the matrix is empty", async () => {
    const empty = makeKnex({ lens_design: [], lens_material: [], lens_base_price: [] });
    await expect(listCompatLensOptions(empty)).resolves.toEqual([]);
  });
});

// ── GET /coatings ────────────────────────────────────────────────────────────

describe("listCompatCoatingOptions", () => {
  it("maps photochromics and AR onto the legacy coating types", async () => {
    const coatings = await listCompatCoatingOptions(pg);
    const byType = coatings.reduce<Record<string, number>>((acc, c2) => {
      acc[c2.type] = (acc[c2.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType["photochromic"]).toBe(PHOTOS.length);
    expect(byType["blue_light"]).toBe(2); // ar-blue-protect, blue-uv-445
    expect(byType["anti_reflective"]).toBe(ARS.length - 2);
  });

  it("never returns polarized or tint — the 2026 list prices neither", async () => {
    const coatings = await listCompatCoatingOptions(pg);
    expect(coatings.some((c2) => c2.type === "polarized" || c2.type === "tint")).toBe(false);
  });

  it("keeps per-category photochromic pricing and quotes the cheapest as the flat legacy price", async () => {
    const coatings = await listCompatCoatingOptions(pg);
    const grey = coatings.find((c2) => c2.id === "photo-grey");
    expect(grey?.price_by_category).toEqual({ sv: 8500, bifocal: 11000, prog: 9000 });
    expect(grey?.price_modifier_cents).toBe(8500);
  });

  it("omits a category a photochromic is not available in", async () => {
    const coatings = await listCompatCoatingOptions(pg);
    const brown = coatings.find((c2) => c2.id === "photo-brown");
    expect(brown?.price_by_category?.sv).toBeNull();
    expect(brown?.compatible_usage_types).not.toContain("single_vision_distance");
    expect(brown?.compatible_usage_types).toEqual(
      expect.arrayContaining(["bifocal", "progressive"])
    );
  });

  it("scopes AR coatings to the designs their group serves", async () => {
    const sv = await listCompatCoatingOptions(pg, "single_vision_distance");
    expect(sv.map((c2) => c2.ar_code).filter(Boolean).sort()).toEqual([
      "ar-blue-protect",
      "ar-green-basic",
      "ar-green-plus",
    ]);

    const prog = await listCompatCoatingOptions(pg, "progressive");
    expect(prog.map((c2) => c2.ar_code).filter(Boolean).sort()).toEqual([
      "adequate",
      "blue-uv-445",
      "crystal",
      "flawless",
    ]);
  });
});

// ── POST /price resolution ───────────────────────────────────────────────────

describe("resolveLegacySelection", () => {
  it("maps each legacy usage_type to a design, cheapest progressive tier first", async () => {
    expect((await resolveLegacySelection(pg, { usage_type: "single_vision_distance" })).design_code).toBe("sv");
    expect((await resolveLegacySelection(pg, { usage_type: "single_vision_reading" })).design_code).toBe("sv");
    expect((await resolveLegacySelection(pg, { usage_type: "non_prescription" })).design_code).toBe("sv");
    expect((await resolveLegacySelection(pg, { usage_type: "progressive" })).design_code).toBe("prog-mid");
    expect((await resolveLegacySelection(pg, { usage_type: "bifocal" })).design_code).toBe("bifocal");
  });

  it("picks the material whose refractive index is nearest the request", async () => {
    const cases: [number, string][] = [
      [1.5, "cr39"],
      [1.56, "1.56"],
      [1.61, "1.61"],
      [1.67, "1.67"],
      [1.74, "1.74"],
    ];
    for (const [index, expected] of cases) {
      const r = await resolveLegacySelection(pg, { usage_type: "single_vision_distance", index });
      expect(r.material_code).toBe(expected);
    }
  });

  it("maps the legacy 1.57 index onto the nearest real material", async () => {
    const r = await resolveLegacySelection(pg, { usage_type: "single_vision_distance", index: 1.57 });
    expect(r.material_code).toBe("1.56"); // |1.56-1.57| = 0.01 vs |1.59-1.57| = 0.02
  });

  it("falls back to the cheapest material when no index is given", async () => {
    const r = await resolveLegacySelection(pg, { usage_type: "single_vision_distance" });
    expect(r.material_code).toBe("cr39"); // $60, the cheapest sv cell
  });

  it("resolves a bare coating type to the cheapest option of that type", async () => {
    const r = await resolveLegacySelection(pg, {
      usage_type: "single_vision_distance",
      index: 1.61,
      coatings: ["anti_reflective", "photochromic"],
    });
    expect(r.ar_code).toBe("ar-green-basic"); // cheapest non-blue sv AR, $60
    expect(r.photo_code).toBe("photo-grey"); // cheapest sv photochromic, $85
  });

  it("resolves blue_light to a blue AR, not just any AR", async () => {
    const r = await resolveLegacySelection(pg, {
      usage_type: "single_vision_distance",
      coatings: ["blue_light"],
    });
    expect(r.ar_code).toBe("ar-blue-protect");
  });

  it("uses the AR group matching the design", async () => {
    const r = await resolveLegacySelection(pg, {
      usage_type: "progressive",
      coatings: ["anti_reflective"],
    });
    expect(r.ar_code).toBe("adequate"); // cheapest bifprog AR
  });

  it("passes concrete matrix codes straight through", async () => {
    const r = await resolveLegacySelection(pg, {
      usage_type: "single_vision_distance",
      index: 1.67,
      coatings: ["ar-green-plus", "trans-x-grey"],
    });
    expect(r.ar_code).toBe("ar-green-plus");
    expect(r.photo_code).toBe("trans-x-grey");
    expect(r.unsupported_coatings).toEqual([]);
  });

  it("reports polarized and tint as unsupported instead of charging for them", async () => {
    const r = await resolveLegacySelection(pg, {
      usage_type: "single_vision_distance",
      coatings: ["polarized", "tint", "anti_reflective"],
    });
    expect(r.unsupported_coatings).toEqual(["polarized", "tint"]);
    expect(r.ar_code).toBe("ar-green-basic");
  });

  it("reports the second AR as ignored — the matrix prices one per lens", async () => {
    const r = await resolveLegacySelection(pg, {
      usage_type: "single_vision_distance",
      coatings: ["anti_reflective", "blue_light"],
    });
    expect(r.ar_code).toBe("ar-green-basic");
    expect(r.ignored_coatings).toEqual(["blue_light"]);
  });

  it("rejects a missing or unknown usage_type with a 400-able error", async () => {
    await expect(resolveLegacySelection(pg, {})).rejects.toBeInstanceOf(LensCompatError);
    await expect(
      resolveLegacySelection(pg, { usage_type: "telescopic" })
    ).rejects.toBeInstanceOf(LensCompatError);
  });
});

// ── End-to-end: legacy request → cents ───────────────────────────────────────

describe("legacy request pricing", () => {
  const price = async (config: Parameters<typeof resolveLegacySelection>[1]) => {
    const resolved = await resolveLegacySelection(pg, config);
    return computeLensBreakdown(pg, resolved);
  };

  it("prices single vision 1.67 with AR and photochromic from the matrix", async () => {
    const b = await price({
      usage_type: "single_vision_distance",
      index: 1.67,
      coatings: ["anti_reflective", "photochromic"],
    });
    expect(b.lens_base_cents).toBe(12000); // sv × 1.67 = $120
    expect(b.ar_cents).toBe(6000); //  ar-green-basic  = $60
    expect(b.photo_cents).toBe(8500); // photo-grey sv  = $85
    expect(b.total_cents).toBe(26500); // $265 lens add-on
  });

  it("prices progressives from the prog category, not the sv one", async () => {
    const b = await price({
      usage_type: "progressive",
      index: 1.61,
      coatings: ["photo-grey"],
    });
    expect(b.category).toBe("prog");
    expect(b.lens_base_cents).toBe(18000); // prog-mid × 1.61 = $180
    expect(b.photo_cents).toBe(9000); // photo-grey prog  = $90, not the sv $85
  });

  it("charges nothing for a photochromic the design cannot have", async () => {
    // photo-brown has no single-vision price (N/A in the 2026 list).
    const b = await computeLensBreakdown(pg, {
      design_code: "sv",
      material_code: "cr39",
      photo_code: "photo-brown",
    });
    expect(b.photo_cents).toBe(0);
    expect(b.total_cents).toBe(6000);
  });

  it("agrees with the storefront's static matrix for a plain sv/cr39 lens", async () => {
    const b = await price({ usage_type: "single_vision_distance", index: 1.5 });
    expect(b.total_cents).toBe(6000); // lensPricing.js BASE.sv.cr39 = $60
  });

  it("prices frame-only as no add-on at all", async () => {
    const b = await computeLensBreakdown(pg, { design_code: "frame-only" });
    expect(b.total_cents).toBe(0);
  });

  it("throws on an unknown design so the route can answer 400, not 500", async () => {
    await expect(
      computeLensBreakdown(pg, { design_code: "nope", material_code: "cr39" })
    ).rejects.toThrow(/Unknown lens design/);
  });
});
