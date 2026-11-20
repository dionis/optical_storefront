import type { Knex } from "@mikro-orm/knex";
import { LensFinishError } from "../src/lib/lens-finish";
import { isHiddenLensCell, loadLensMatrix, publicBaseCell } from "../src/lib/lens-matrix";
import { computeLensBreakdown } from "../src/lib/lens-quote";
import { buildLensGroups, EMPTY_DISCOUNTS, type LensSectionInput } from "../src/lib/price-matrix";

/**
 * A lens cell switched off (11-nov-2026, `lens_base_price.is_active`): a work
 * the shop does not do for now. It stays in the owner's matrix with its
 * prices, and is neither offered (till, web) nor quoted.
 */
type Row = Record<string, unknown>;
function fakePg(tables: Record<string, Row[]>): Knex {
  return ((name: string) => {
    let rows = tables[name] ?? [];
    const b: Record<string, unknown> = {
      whereNull: () => b,
      where: (o: Row) => {
        rows = rows.filter((r) => Object.entries(o).every(([k, v]) => r[k] === v));
        return b;
      },
      orderBy: () => b,
      select: () => b,
      then: (ok: (v: Row[]) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, ko),
      catch: (f: (e: unknown) => unknown) => Promise.resolve(rows).catch(f),
    };
    return b;
  }) as unknown as Knex;
}

const tables = (stockActive: boolean): Record<string, Row[]> => ({
  lens_design: [{ code: "bifocal", category: "bifocal", is_active: true, requires_add: true, label_es: "Bifocal", label_en: "Bifocal", sort: 1 }],
  lens_material: [{ code: "cr39", is_active: true, label_es: "CR-39", label_en: "CR-39", sort: 1 }],
  lens_base_price: [
    { design_code: "bifocal", material_code: "cr39", finish: "stock", price_cents: 13000, cost_cents: 400, is_active: stockActive },
    { design_code: "bifocal", material_code: "cr39", finish: "digital", price_cents: 14000, cost_cents: 2075, is_active: true },
  ],
  lens_photo_option: [],
  lens_ar_option: [],
  lens_treatment_price: [],
});

describe("a lens cell switched off", () => {
  it("isHiddenLensCell: only an explicit false hides (a database without the column offers everything)", () => {
    expect(isHiddenLensCell({ is_active: false })).toBe(true);
    expect(isHiddenLensCell({ is_active: true })).toBe(false);
    expect(isHiddenLensCell({})).toBe(false);
    expect(publicBaseCell({ design_code: "sv", material_code: "cr39", finish: "stock", price_cents: 100, is_active: false, cost_cents: 5 })).toEqual({ design_code: "sv", material_code: "cr39", finish: "stock", price_cents: 100, hidden: true });
  });

  it("the list the till and the web read leaves it out; the owner's matrix keeps it, flagged", async () => {
    const offered = await loadLensMatrix(fakePg(tables(false)));
    expect(offered.base_prices).toEqual([{ design_code: "bifocal", material_code: "cr39", finish: "digital", price_cents: 14000 }]);
    const owner = await loadLensMatrix(fakePg(tables(false)), { includeHidden: true });
    expect(owner.base_prices.map((c) => [c.finish, c.hidden ?? false])).toEqual([["stock", true], ["digital", false]]);
    expect((await loadLensMatrix(fakePg(tables(true)))).base_prices).toHaveLength(2);
  });

  it("is never quoted: refused like a cell with no price, while its sibling finish still sells", async () => {
    const sel = { design_code: "bifocal", material_code: "cr39", finish: "stock" as const };
    expect((await computeLensBreakdown(fakePg(tables(true)), sel)).lens_base_cents).toBe(13000);
    await expect(computeLensBreakdown(fakePg(tables(false)), sel)).rejects.toBeInstanceOf(LensFinishError);
    expect((await computeLensBreakdown(fakePg(tables(false)), { ...sel, finish: "digital" })).lens_base_cents).toBe(14000);
  });

  it("the owner's matrix row carries `active` and keeps its prices", () => {
    const input: LensSectionInput = {
      designs: [{ code: "bifocal", label_es: "Bifocal", label_en: "Bifocal", category: "bifocal" }],
      materials: [{ code: "cr39", label_es: "CR-39", label_en: "CR-39" }],
      cells: [
        { design_code: "bifocal", material_code: "cr39", finish: "stock", price_cents: 13000, cost_cents: 400, active: false },
        { design_code: "bifocal", material_code: "cr39", finish: "digital", price_cents: 14000, cost_cents: 2075 },
      ],
      storeRows: new Map(),
    };
    const rows = buildLensGroups(input, [{ id: "est_1", code: "Op1", name: "A", color: "#111111" }], EMPTY_DISCOUNTS, true)[0].rows;
    expect(rows.map((r) => [r.finish, r.active, r.master_cents])).toEqual([["stock", false, 13000], ["digital", true, 14000]]);
  });
});
