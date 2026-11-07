/**
 * The lens price list payload shared by GET /store/lens-config/matrix (public,
 * master prices) and GET /admin/pos/lens-matrix (the till, store prices).
 *
 * Knex is stubbed as in lens-compat.test.ts, plus `.select()` (the base cells
 * are read column by column), so the two things that must hold are pinned
 * without a database: the lab's `cost_cents` never leaves, and each finish
 * cell reaches the client so the POS toggle reflects what the owner priced.
 */
import type { Knex } from "@mikro-orm/knex";
import { applyStoreLensMatrix, loadLensMatrix, loadLensMatrixForStore, publicBaseCell } from "../src/lib/lens-matrix";
import type { LensStorePriceLike } from "../src/lib/pricing-overview";

type Row = Record<string, unknown>;

const DESIGNS: Row[] = [
  { code: "sv", category: "sv", label_es: "Visión Sencilla", label_en: "Single Vision", requires_rx: true, requires_add: false, sort: 0, is_active: true, deleted_at: null },
  { code: "bifocal", category: "bifocal", label_es: "Bifocal FT-28", label_en: "Bifocal FT-28", requires_rx: true, requires_add: true, sort: 1, is_active: true, deleted_at: null },
  { code: "prog-mid", category: "prog", label_es: "Progresivo Gama Media", label_en: "Progressive · Mid", requires_rx: true, requires_add: true, sort: 2, is_active: true, deleted_at: null },
  { code: "retired", category: "sv", label_es: "Viejo", label_en: "Old", requires_rx: true, requires_add: false, sort: 9, is_active: false, deleted_at: null },
];

const MATERIALS: Row[] = [
  { code: "cr39", label_es: "CR-39 (Resina)", label_en: "CR-39 (Resin)", desc_es: "", desc_en: "", max_abs: 2, sort: 0, is_active: true, deleted_at: null },
  { code: "poly", label_es: "Policarbonato", label_en: "Polycarbonate", desc_es: "", desc_en: "", max_abs: 3, sort: 1, is_active: true, deleted_at: null },
];

const BASE_PRICES: Row[] = [
  { design_code: "sv", material_code: "cr39", finish: "stock", price_cents: 6000, cost_cents: 1800, deleted_at: null },
  { design_code: "sv", material_code: "cr39", finish: "digital", price_cents: 9500, cost_cents: 3100, deleted_at: null },
  { design_code: "sv", material_code: "poly", finish: "stock", price_cents: 9000, cost_cents: null, deleted_at: null },
  { design_code: "bifocal", material_code: "cr39", finish: "stock", price_cents: 13000, cost_cents: null, deleted_at: null },
  { design_code: "prog-mid", material_code: "cr39", finish: "digital", price_cents: 18000, cost_cents: 7000, deleted_at: null },
  { design_code: "prog-mid", material_code: "poly", finish: "digital", price_cents: 18000, cost_cents: null, deleted_at: "2026-01-01" },
];

const PHOTOS: Row[] = [
  { code: "photo-grey", label_es: "Fotocromático Grey", label_en: "Photochromic Grey", colors: ["grey"], price_sv_cents: 8500, price_bifocal_cents: 11000, price_prog_cents: 9000, sort: 0, is_active: true, deleted_at: null },
  { code: "photo-brown", label_es: "Fotocromático Brown", label_en: "Photochromic Brown", colors: ["brown"], price_sv_cents: null, price_bifocal_cents: 11000, price_prog_cents: 9000, sort: 1, is_active: true, deleted_at: null },
];

const ARS: Row[] = [
  { code: "ar-green-basic", label_es: "AR Green Básico", label_en: "AR Green Basic", ar_group: "sv", price_cents: 6000, sort: 0, is_active: true, deleted_at: null },
  { code: "crystal", label_es: "Crystal", label_en: "Crystal", ar_group: "bifprog", price_cents: 8000, sort: 4, is_active: true, deleted_at: null },
];

const TREATMENTS: Row[] = [
  { design_code: "sv", material_code: "cr39", treatment_code: "photo", price_cents: 8000, deleted_at: null },
];

const TABLES: Record<string, Row[]> = {
  lens_design: DESIGNS,
  lens_material: MATERIALS,
  lens_base_price: BASE_PRICES,
  lens_photo_option: PHOTOS,
  lens_ar_option: ARS,
  lens_treatment_price: TREATMENTS,
};

/**
 * Minimal chainable Knex stand-in. `missingColumns` makes a `.select()` that
 * names one of them reject when awaited, like Postgres before a migration.
 */
function makeKnex(tables: Record<string, Row[]> = TABLES, missingColumns: string[] = []): Knex {
  const build = (rows: Row[], missing: string | null = null) => {
    const state = { rows: [...rows], error: missing ? new Error(`relation "${missing}" does not exist`) : null as Error | null };
    const builder: Record<string, unknown> = {
      whereNull(col: string) {
        state.rows = state.rows.filter((r) => r[col] == null);
        return builder;
      },
      where(filters: Row) {
        state.rows = state.rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        return builder;
      },
      orderBy(col: string, dir: "asc" | "desc") {
        const sign = dir === "desc" ? -1 : 1;
        state.rows.sort((a, b) => sign * (Number(a[col]) - Number(b[col])));
        return builder;
      },
      select(...cols: string[]) {
        const gone = cols.find((c) => missingColumns.includes(c));
        if (gone) state.error = new Error(`column "${gone}" does not exist`);
        else state.rows = state.rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
        return builder;
      },
      then(resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        const result = state.error ? Promise.reject(state.error) : Promise.resolve(state.rows);
        return result.then(resolve, reject);
      },
      catch(reject: (e: unknown) => unknown) {
        return (builder.then as (a: undefined, b: typeof reject) => Promise<unknown>)(undefined, reject);
      },
    };
    return builder;
  };
  const fn = (table: string) => (table in tables ? build(tables[table] as Row[]) : build([], table));
  return fn as unknown as Knex;
}

const flatten = (payload: unknown): Row[] => {
  const out: Row[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      out.push(v as Row);
      Object.values(v as Row).forEach(walk);
    }
  };
  walk(payload);
  return out;
};

describe("loadLensMatrix", () => {
  it("serves the active rows of every table in the shape the storefront adapts", async () => {
    const m = await loadLensMatrix(makeKnex());
    expect(Object.keys(m).sort()).toEqual(["ars", "base_prices", "designs", "materials", "photos", "treatment_prices"]);
    expect(m.designs.map((d) => d["code"])).toEqual(["sv", "bifocal", "prog-mid"]); // the inactive one is out
    expect(m.materials).toHaveLength(2);
    expect(m.photos).toHaveLength(2);
    expect(m.ars).toHaveLength(2);
    expect(m.treatment_prices).toHaveLength(1);
  });

  it("never lets the lab's cost_cents out, anywhere in the payload", async () => {
    const m = await loadLensMatrix(makeKnex());
    expect(flatten(m).some((r) => "cost_cents" in r)).toBe(false);
    expect(JSON.stringify(m)).not.toContain("cost_cents");
  });

  it("carries one cell per (design, material, finish), deleted cells excluded", async () => {
    const m = await loadLensMatrix(makeKnex());
    expect(m.base_prices).toEqual([
      { design_code: "sv", material_code: "cr39", finish: "stock", price_cents: 6000 },
      { design_code: "sv", material_code: "cr39", finish: "digital", price_cents: 9500 },
      { design_code: "sv", material_code: "poly", finish: "stock", price_cents: 9000 },
      { design_code: "bifocal", material_code: "cr39", finish: "stock", price_cents: 13000 },
      { design_code: "prog-mid", material_code: "cr39", finish: "digital", price_cents: 18000 },
    ]);
  });

  it("before the finish migration, serves the same cells without a finish key", async () => {
    const m = await loadLensMatrix(makeKnex(TABLES, ["finish"]));
    expect(m.base_prices).toHaveLength(5);
    expect(m.base_prices.every((c) => !("finish" in c))).toBe(true);
    expect(m.base_prices[0]).toEqual({ design_code: "sv", material_code: "cr39", price_cents: 6000 });
  });

  it("answers [] for the treatment matrix when its table does not exist yet", async () => {
    const { lens_treatment_price: _gone, ...rest } = TABLES;
    void _gone;
    const m = await loadLensMatrix(makeKnex(rest));
    expect(m.treatment_prices).toEqual([]);
    expect(m.base_prices).toHaveLength(5);
  });

  it("publicBaseCell drops every column but the four public ones", () => {
    expect(publicBaseCell({ id: "x", design_code: "sv", material_code: "cr39", finish: "digital", price_cents: "9500", cost_cents: 3100, created_at: "…" })).toEqual({
      design_code: "sv",
      material_code: "cr39",
      finish: "digital",
      price_cents: 9500,
    });
    expect(publicBaseCell({ design_code: "sv", material_code: "cr39", finish: "weird", price_cents: 1 })).toEqual({ design_code: "sv", material_code: "cr39", price_cents: 1 });
  });
});

describe("applyStoreLensMatrix (the till's prices)", () => {
  const STORE_ROWS: LensStorePriceLike[] = [
    { establishment_id: "est_1", item_kind: "adjust", item_key: "all", value: 10 },
    { establishment_id: "est_1", item_kind: "base", item_key: "sv:cr39:digital", value: 9900 },
    { establishment_id: "est_1", item_kind: "base", item_key: "prog-mid:cr39", value: 17000 },
    { establishment_id: "est_1", item_kind: "photo", item_key: "photo-grey:sv", value: 8000 },
    { establishment_id: "est_1", item_kind: "ar", item_key: "crystal", value: 8500 },
  ];

  it("returns the master untouched without store rows", async () => {
    const master = await loadLensMatrix(makeKnex());
    expect(applyStoreLensMatrix(master, [])).toBe(master);
    expect(await loadLensMatrixForStore(makeKnex(), null)).toEqual(master);
  });

  it("prices each cell as the quote does: exact override, else the store's %, else the master", async () => {
    const m = applyStoreLensMatrix(await loadLensMatrix(makeKnex()), STORE_ROWS);
    const cell = (d: string, mat: string, f?: string) => m.base_prices.find((c) => c.design_code === d && c.material_code === mat && (f === undefined || c.finish === f))?.price_cents;
    expect(cell("sv", "cr39", "stock")).toBe(6600); // +10 %
    expect(cell("sv", "cr39", "digital")).toBe(9900); // exact override on the digital key
    expect(cell("prog-mid", "cr39")).toBe(17000); // a progressive's only cell keeps the short key
    expect(cell("bifocal", "cr39")).toBe(14300);
    const grey = m.photos.find((p) => p["code"] === "photo-grey")!;
    expect(grey["price_sv_cents"]).toBe(8000); // override on (code, category)
    expect(grey["price_bifocal_cents"]).toBe(12100); // the % elsewhere
    const brown = m.photos.find((p) => p["code"] === "photo-brown")!;
    expect(brown["price_sv_cents"]).toBeNull(); // not offered stays not offered
    expect(m.ars.find((a) => a["code"] === "crystal")?.["price_cents"]).toBe(8500);
    expect(m.ars.find((a) => a["code"] === "ar-green-basic")?.["price_cents"]).toBe(6600);
    // The treatment matrix is the master's (see the note in lib/lens-matrix.ts).
    expect(m.treatment_prices[0]["price_cents"]).toBe(8000);
  });

  it("keeps the payload cost-free and finish-complete with a store applied", async () => {
    const m = applyStoreLensMatrix(await loadLensMatrix(makeKnex()), STORE_ROWS);
    expect(JSON.stringify(m)).not.toContain("cost_cents");
    expect(m.base_prices.filter((c) => c.design_code === "sv" && c.material_code === "cr39").map((c) => c.finish).sort()).toEqual(["digital", "stock"]);
  });
});
