/**
 * Stock vs surfaced ("tallado digital") lenses. Pure functions only: the finish
 * rules, the store-override keys that must keep every existing row valid, the
 * server-side redaction of the lab cost, the POS line parser, the printed
 * name and the cost sheet that reads the cell's cost instead of the rules.
 */
import { computeCostSheet, type CostRule } from "../src/lib/costing";
import { clearLensCellCostCache, lensCellCostCents, lensCellCostFrom, setLensCellCostCache } from "../src/lib/lens-cost";
import {
  cellForFinish,
  defaultLensFinish,
  LensFinishError,
  lensFinishLabel,
  parseLensFinish,
  resolveLensFinish,
  withFinishSuffix,
} from "../src/lib/lens-finish";
import { cleanLines } from "../src/lib/pos";
import {
  applyStoreLensBreakdown,
  lensBaseKey,
  lensPriceDenied,
  parseLensBaseKey,
  redactLensCosts,
  type LensBaseCellView,
} from "../src/lib/pricing-overview";

describe("finish resolution", () => {
  it("parses only the two codes", () => {
    expect(parseLensFinish("stock")).toBe("stock");
    expect(parseLensFinish("digital")).toBe("digital");
    expect(parseLensFinish("Digital")).toBeNull();
    expect(parseLensFinish("")).toBeNull();
    expect(parseLensFinish(null)).toBeNull();
  });

  it("defaults to stock, and to digital for progressives", () => {
    expect(defaultLensFinish("sv")).toBe("stock");
    expect(defaultLensFinish("bifocal")).toBe("stock");
    expect(defaultLensFinish("prog")).toBe("digital");
    expect(defaultLensFinish(null)).toBe("stock");
  });

  it("honours an explicit finish, even one the design cannot have (the quote then fails loudly)", () => {
    expect(resolveLensFinish(null, "prog")).toBe("digital");
    expect(resolveLensFinish("digital", "sv")).toBe("digital");
    expect(resolveLensFinish("stock", "prog")).toBe("stock");
  });

  it("matches a row without the column (un-migrated database) to any finish", () => {
    const legacy: Array<{ finish?: unknown; price_cents: number }> = [{ price_cents: 6000 }];
    expect(cellForFinish(legacy, "digital")).toBe(legacy[0]);
    const migrated = [{ finish: "stock", price_cents: 6000 }, { finish: "digital", price_cents: 9500 }];
    expect(cellForFinish(migrated, "digital")?.price_cents).toBe(9500);
    expect(cellForFinish([migrated[0]], "digital")).toBeNull();
  });

  it("carries the POS reason on the error", () => {
    const e = new LensFinishError("sv", "poly", "digital");
    expect(e.reason).toBe("finish_unavailable");
    expect(e.message).toContain("sv/poly");
  });
});

describe("lensBaseKey (store overrides keep their old keys)", () => {
  it("spells a stock cell exactly as before finishes existed", () => {
    expect(lensBaseKey("sv", "cr39")).toBe("sv:cr39");
    expect(lensBaseKey("sv", "cr39", "stock", "sv")).toBe("sv:cr39");
  });

  it("adds :digital only where the design also has a stock cell", () => {
    expect(lensBaseKey("sv", "cr39", "digital", "sv")).toBe("sv:cr39:digital");
    expect(lensBaseKey("bifocal", "poly", "digital", "bifocal")).toBe("bifocal:poly:digital");
    // A progressive's one cell is digital and keeps its legacy key.
    expect(lensBaseKey("prog-mid", "cr39", "digital", "prog")).toBe("prog-mid:cr39");
  });

  it("parses both spellings and rejects anything else", () => {
    expect(parseLensBaseKey("sv:cr39")).toEqual({ design_code: "sv", material_code: "cr39", finish: "stock" });
    expect(parseLensBaseKey("sv:1.67:digital")).toEqual({ design_code: "sv", material_code: "1.67", finish: "digital" });
    expect(parseLensBaseKey("sv:cr39:gold")).toBeNull();
    expect(parseLensBaseKey("sv")).toBeNull();
    expect(parseLensBaseKey("sv:cr39:digital:x")).toBeNull();
    expect(lensPriceDenied("base", "sv:cr39:gold", 10)).toBe("bad_key");
    expect(lensPriceDenied("base", "sv:cr39:digital", 10)).toBeNull();
  });

  it("applies a store's digital override only to the digital quote", () => {
    const rows = [
      { establishment_id: "e1", item_kind: "base", item_key: "sv:cr39", value: 7000 },
      { establishment_id: "e1", item_kind: "base", item_key: "sv:cr39:digital", value: 11000 },
    ];
    const base = { lens_base_cents: 6000, photo_cents: 0, ar_cents: 0, total_cents: 6000, category: "sv" };
    const sel = { design_code: "sv", material_code: "cr39" };
    expect(applyStoreLensBreakdown({ ...base, finish: "stock" as const }, rows, sel).lens_base_cents).toBe(7000);
    expect(applyStoreLensBreakdown({ ...base, lens_base_cents: 9500, finish: "digital" as const }, rows, sel).lens_base_cents).toBe(11000);
    // An older caller without `finish` is the default cell: stock.
    expect(applyStoreLensBreakdown(base, rows, sel).lens_base_cents).toBe(7000);
    // A progressive's digital quote reads its legacy key.
    const prog = [{ establishment_id: "e1", item_kind: "base", item_key: "prog-mid:cr39", value: 20000 }];
    expect(
      applyStoreLensBreakdown({ ...base, lens_base_cents: 18000, category: "prog", finish: "digital" as const }, prog, { design_code: "prog-mid", material_code: "cr39" }).lens_base_cents
    ).toBe(20000);
  });
});

describe("redactLensCosts (the lab cost never leaves for a plain reader)", () => {
  const base: LensBaseCellView[] = [
    { design_code: "sv", material_code: "cr39", finish: "stock", cents: 6000, store_cents: null, cost_cents: 1800 },
    { design_code: "sv", material_code: "cr39", finish: "digital", cents: 9500, store_cents: null, cost_cents: null },
  ];
  it("strips the key itself, not just the value", () => {
    const out = redactLensCosts({ base, cost_access: true }, false);
    expect(out.cost_access).toBe(false);
    expect(out.base.every((c) => !("cost_cents" in c))).toBe(true);
    expect(out.base[0]).toEqual({ design_code: "sv", material_code: "cr39", finish: "stock", cents: 6000, store_cents: null });
  });
  it("keeps it for a reader with cost privileges", () => {
    const out = redactLensCosts({ base, cost_access: false }, true);
    expect(out.cost_access).toBe(true);
    expect(out.base[0].cost_cents).toBe(1800);
  });
});

describe("cleanLines: finish", () => {
  const line = (selection: Record<string, unknown>) => cleanLines([{ kind: "frame", variant_id: "v1", selection }]);
  it("keeps a valid finish and leaves it null when absent", () => {
    const stock = line({ design_code: "sv", material_code: "cr39", finish: "stock" });
    expect("lines" in stock && stock.lines[0].selection.finish).toBe("stock");
    const digital = line({ design_code: "bifocal", material_code: "poly", finish: "digital" });
    expect("lines" in digital && digital.lines[0].selection.finish).toBe("digital");
    const none = line({ design_code: "sv", material_code: "cr39" });
    expect("lines" in none && none.lines[0].selection.finish).toBeNull();
  });
  it("rejects any other value instead of defaulting it", () => {
    expect(line({ design_code: "sv", material_code: "cr39", finish: "tallado" })).toEqual({ reason: "bad_line" });
    expect(line({ design_code: "sv", material_code: "cr39", finish: 1 })).toEqual({ reason: "bad_line" });
  });
  it("drops the finish of a bare frame", () => {
    const r = line({ design_code: "frame-only", finish: "digital" });
    expect("lines" in r && r.lines[0].selection.finish).toBeNull();
  });
});

describe("printed lens name", () => {
  const label = { es: "Visión Sencilla", en: "Single Vision" };
  it("appends the finish word in both languages", () => {
    expect(withFinishSuffix(label, "stock", "sv")).toEqual({ es: "Visión Sencilla (stock)", en: "Single Vision (stock)" });
    expect(withFinishSuffix(label, "digital", "bifocal")).toEqual({ es: "Visión Sencilla (tallado digital)", en: "Single Vision (digital surfaced)" });
    expect(lensFinishLabel("digital").en).toBe("digital surfaced");
  });
  it("says nothing on a progressive and tolerates a missing label", () => {
    expect(withFinishSuffix({ es: "DVG Camber", en: "DVG Camber" }, "digital", "prog")).toEqual({ es: "DVG Camber", en: "DVG Camber" });
    expect(withFinishSuffix(null, "stock", "sv")).toBeNull();
    expect(withFinishSuffix(label, null, "sv")).toBe(label);
  });
});

describe("lens cell cost in the cost sheet", () => {
  const rule = (kind: CostRule["kind"], match_key: string, amount: number): CostRule => ({
    id: `${kind}:${match_key}`,
    kind,
    match_key,
    label: `${kind} ${match_key}`,
    amount,
    unit: "fixed",
    active: true,
    sort_order: 0,
    notes: null,
  });
  const rules = [rule("lens_design", "sv", 10), rule("lens_material", "cr39", 5), rule("lens_ar", "ar-green-basic", 7)];
  const order = { total: 200, items: [{ quantity: 1, sku: null, lens: { design_code: "sv", material_code: "cr39", ar_code: "ar-green-basic" } }] };
  const cells = [
    { design_code: "sv", material_code: "cr39", finish: "stock" as const, cost_cents: 1800 },
    { design_code: "sv", material_code: "cr39", finish: "digital" as const, cost_cents: 3100 },
    { design_code: "prog-mid", material_code: "cr39", finish: "digital" as const, cost_cents: 6200 },
    { design_code: "sv", material_code: "poly", finish: "stock" as const, cost_cents: null },
  ];
  const categories = new Map([["sv", "sv"], ["prog-mid", "prog"]]);

  afterEach(() => clearLensCellCostCache());

  it("resolves the default finish per design and null for an unpriced cost", () => {
    expect(lensCellCostFrom(cells, categories, "sv", "cr39", null)).toBe(1800);
    expect(lensCellCostFrom(cells, categories, "sv", "cr39", "digital")).toBe(3100);
    expect(lensCellCostFrom(cells, categories, "prog-mid", "cr39", null)).toBe(6200);
    expect(lensCellCostFrom(cells, categories, "sv", "poly", null)).toBeNull();
    expect(lensCellCostFrom(cells, categories, "sv", "1.67", null)).toBeNull();
  });

  it("answers null until the cache was loaded, so the rules keep deciding", () => {
    expect(lensCellCostCents("sv", "cr39", null)).toBeNull();
    setLensCellCostCache(cells, categories);
    expect(lensCellCostCents("sv", "cr39", null)).toBe(1800);
    expect(lensCellCostCents("prog-mid", "cr39", null)).toBe(6200);
  });

  it("replaces the design + material rules with the cell's cost and keeps the treatment rules", () => {
    const byRules = computeCostSheet(order, rules, null, null, null, () => null, () => null);
    expect(byRules.materials_total).toBe(22); // 10 + 5 + 7
    const byCell = computeCostSheet(order, rules, null, null, null, () => null, (d, m, f) => lensCellCostFrom(cells, categories, d, m, f));
    expect(byCell.materials_total).toBe(25); // 18 + 7
    const lensLine = byCell.lines.find((l) => l.key === "lens_design:sv");
    expect(lensLine).toMatchObject({ kind: "lens_design", source: "supplier", amount: 18, match_key: "sv:cr39" });
    expect(byCell.lines.some((l) => l.key === "lens_material:cr39")).toBe(false);
    expect(byCell.lines.some((l) => l.key === "lens_ar:ar-green-basic")).toBe(true);
  });

  it("costs a digital line with the digital cell", () => {
    const digital = { ...order, items: [{ ...order.items[0], lens: { ...order.items[0].lens, finish: "digital" as const } }] };
    const sheet = computeCostSheet(digital, rules, null, null, null, () => null, (d, m, f) => lensCellCostFrom(cells, categories, d, m, f));
    expect(sheet.lines.find((l) => l.key === "lens_design:sv")).toMatchObject({ amount: 31, match_key: "sv:cr39:digital" });
  });

  it("falls back to the rules for a cell without a cost", () => {
    const poly = { ...order, items: [{ ...order.items[0], lens: { design_code: "sv", material_code: "poly" } }] };
    const sheet = computeCostSheet(poly, [...rules, rule("lens_material", "poly", 9)], null, null, null, () => null, (d, m, f) => lensCellCostFrom(cells, categories, d, m, f));
    expect(sheet.lines.map((l) => l.key)).toEqual(expect.arrayContaining(["lens_design:sv", "lens_material:poly"]));
    expect(sheet.materials_total).toBe(19);
  });
});
