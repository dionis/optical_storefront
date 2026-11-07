/**
 * «Productos y precios»: the cell writer (`executeCellOp`) dispatches each
 * planned write to the panel's existing writer with the right arguments —
 * every writer stubbed, no database.
 */
jest.mock("../src/lib/store-pricing-data", () => ({
  ...jest.requireActual("../src/lib/store-pricing-data"),
  openRules: jest.fn(async () => []),
  replaceRule: jest.fn(async () => undefined),
}));
jest.mock("../src/lib/lens-price-write", () => ({ writeLensMaster: jest.fn(async () => null) }));
jest.mock("../src/lib/audit", () => ({ ...jest.requireActual("../src/lib/audit"), recordAudit: jest.fn(async () => undefined) }));
jest.mock("../src/lib/frame-cost", () => ({
  ...jest.requireActual("../src/lib/frame-cost"),
  setOwnerFrameCost: jest.fn(async () => ({ row: null, before: null })),
}));
jest.mock("../src/lib/pricing-overview", () => ({
  ...jest.requireActual("../src/lib/pricing-overview"),
  upsertStoreLensPrice: jest.fn(async () => null),
}));

import { executeCellOp, setItemDiscount } from "../src/lib/price-matrix-data";
import { planCellWrite, type CellOp, type MatrixRow } from "../src/lib/price-matrix";
import { openRules, replaceRule } from "../src/lib/store-pricing-data";
import { writeLensMaster } from "../src/lib/lens-price-write";
import { setOwnerFrameCost } from "../src/lib/frame-cost";
import { upsertStoreLensPrice } from "../src/lib/pricing-overview";
import { recordAudit } from "../src/lib/audit";
import { STORE_PRICING_MODULE } from "../src/modules/store-pricing";

const A = "est_A";

/** A fake store-pricing service holding `store_item_discount` rows in memory. */
function container() {
  const rows: Array<Record<string, unknown>> = [];
  let n = 0;
  const svc = {
    listStoreItemDiscounts: jest.fn(async (f: Record<string, unknown>) =>
      rows.filter((r) => !r["deleted_at"] && Object.entries(f).every(([k, v]) => r[k] === v))
    ),
    createStoreItemDiscounts: jest.fn(async (d: Record<string, unknown>) => rows.push({ id: `sidc_${++n}`, ...d })),
    updateStoreItemDiscounts: jest.fn(async (list: Array<Record<string, unknown>>) => {
      for (const u of list) Object.assign(rows.find((r) => r["id"] === u["id"]) ?? {}, u);
    }),
    softDeleteStoreItemDiscounts: jest.fn(async (ids: string[]) => {
      for (const r of rows) if (ids.includes(String(r["id"]))) r["deleted_at"] = "now";
    }),
  };
  return { c: { resolve: (key: string) => (key === STORE_PRICING_MODULE ? svc : {}) } as never, svc, rows };
}

const op = (input: Parameters<typeof planCellWrite>[0]): CellOp => {
  const r = planCellWrite(input);
  if ("reason" in r) throw new Error(r.reason);
  return r.op;
};

const frameRow: MatrixRow = { kind: "frame", key: "prod_1", product_id: "prod_1", sku: "DC 407", title: "DC407", price_scope: "frame", stores: {} };
const caseRow: MatrixRow = { ...frameRow, kind: "case", key: "prod_9", product_id: "prod_9", sku: "CASE X1" };
const progRow: MatrixRow = { kind: "lens", key: "prog-mid:cr39", design_code: "prog-mid", material_code: "cr39", finish: "digital", title: "CR-39 · digital", stores: {} };

beforeEach(() => jest.clearAllMocks());

describe("executeCellOp", () => {
  it("frame cost → setOwnerFrameCost with the model's SKU, audited", async () => {
    const { c } = container();
    expect(await executeCellOp(c, op({ kind: "frame", key: "prod_1", field: "cost", store: null, value: 16.5 }), frameRow, "u")).toBeNull();
    expect(setOwnerFrameCost).toHaveBeenCalledWith(c, { sku: "DC 407", costCents: 1650 }, "u");
    expect(recordAudit).toHaveBeenCalledWith(c, expect.objectContaining({ action: "cost.change", entity: "frame_cost", entityId: "DC407" }));
  });

  it("frame price → the store's exact price; clearing removes it", async () => {
    const { c } = container();
    await executeCellOp(c, op({ kind: "frame", key: "prod_1", field: "price", store: A, value: 54 }), frameRow, "u");
    expect(replaceRule).toHaveBeenCalledWith(c, { establishmentId: A, scope: "frame", target: "prod_1", family: "price" }, { mode: "override", value: 54, source: "price-matrix" }, "u");
    await executeCellOp(c, op({ kind: "frame", key: "prod_1", field: "price", store: A, value: null }), frameRow, "u");
    expect(replaceRule).toHaveBeenLastCalledWith(c, { establishmentId: A, scope: "frame", target: "prod_1", family: "price" }, null, "u");
  });

  it("a case row writes a case rule and closes an exact price left in the frame scope", async () => {
    const { c } = container();
    (openRules as jest.Mock).mockResolvedValueOnce([
      { establishment_id: A, scope: "frame", target: "prod_9", mode: "override", value: 9, valid_from: "2026-01-01", valid_to: null },
    ]);
    await executeCellOp(c, op({ kind: "case", key: "prod_9", field: "price", store: A, value: 6 }), caseRow, "u");
    const calls = (replaceRule as jest.Mock).mock.calls;
    expect(calls[0][1]).toEqual({ establishmentId: A, scope: "frame", target: "prod_9", family: "price" });
    expect(calls[0][2]).toBeNull();
    expect(calls[1][1]).toEqual({ establishmentId: A, scope: "case", target: "prod_9", family: "price" });
  });

  it("lens cost → the master writer, with the finish spelled out for a progressive", async () => {
    const { c } = container();
    await executeCellOp(c, op({ kind: "lens", key: "prog-mid:cr39", field: "cost", store: null, value: 30 }), progRow, "u");
    expect(writeLensMaster).toHaveBeenCalledWith(c, "base", "prog-mid:cr39:digital", "cost", 3000);
    const photo: MatrixRow = { kind: "photo", key: "photo-grey:sv", code: "photo-grey", title: "x", stores: {} };
    await executeCellOp(c, op({ kind: "photo", key: "photo-grey:sv", field: "cost", store: "", value: null }), photo, "u");
    expect(writeLensMaster).toHaveBeenLastCalledWith(c, "photo", "photo-grey:sv", "cost", null);
  });

  it("an item the master writer does not know answers its reason", async () => {
    const { c } = container();
    (writeLensMaster as jest.Mock).mockResolvedValueOnce("unknown_item");
    expect(await executeCellOp(c, op({ kind: "ar", key: "ar-x", field: "cost", store: null, value: 3 }), { kind: "ar", key: "ar-x", title: "", stores: {} }, "u")).toBe("unknown_item");
  });

  it("lens price → the store's own cell under the stored key", async () => {
    const { c } = container();
    await executeCellOp(c, op({ kind: "lens", key: "prog-mid:cr39:digital", field: "price", store: A, value: 140 }), progRow, "u");
    expect(upsertStoreLensPrice).toHaveBeenCalledWith(c, { establishmentId: A, kind: "base", key: "prog-mid:cr39", value: 14000 }, "u");
  });

  it("discount → store_item_discount under the row's kind, clearing the other kind's", async () => {
    const { c, rows } = container();
    rows.push({ id: "old", establishment_id: A, item_kind: "frame", item_key: "prod_9", pct: 5 });
    await executeCellOp(c, op({ kind: "case", key: "prod_9", field: "discount", store: A, value: 10 }), caseRow, "u");
    const live = rows.filter((r) => !r["deleted_at"]);
    expect(live.map((r) => [r["item_kind"], r["item_key"], r["pct"]])).toEqual([["case", "prod_9", 10]]);
  });
});

describe("setItemDiscount", () => {
  it("creates, updates and soft-deletes one live row, auditing each change", async () => {
    const { c, rows, svc } = container();
    expect(await setItemDiscount(c, { storeId: A, kind: "lens", key: "sv:cr39", pct: 12.345 }, "u")).toEqual({ before: null, after: 12.35 });
    expect(await setItemDiscount(c, { storeId: A, kind: "lens", key: "sv:cr39", pct: 20 }, "u")).toEqual({ before: 12.35, after: 20 });
    expect(rows.filter((r) => !r["deleted_at"])).toHaveLength(1);
    expect(await setItemDiscount(c, { storeId: A, kind: "lens", key: "sv:cr39", pct: 0 }, "u")).toEqual({ before: 20, after: null });
    expect(svc.softDeleteStoreItemDiscounts).toHaveBeenCalled();
    expect(rows.filter((r) => !r["deleted_at"])).toHaveLength(0);
    expect((recordAudit as jest.Mock).mock.calls.map((call) => [call[1].action, call[1].entity, call[1].before?.pct ?? null, call[1].after?.pct ?? null])).toEqual([
      ["price.change", "item_discount", null, 12.35],
      ["price.change", "item_discount", 12.35, 20],
      ["price.change", "item_discount", 20, null],
    ]);
    // Clearing what is already clear writes and audits nothing.
    await setItemDiscount(c, { storeId: A, kind: "lens", key: "sv:cr39", pct: null }, "u");
    expect(recordAudit).toHaveBeenCalledTimes(3);
  });
});
