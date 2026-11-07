#!/usr/bin/env node
// Round-trip test of the panel's dependency-free Excel code (no test runner in
// the storefront): src/admin/exportXlsx.js (styled writer + reader) and
// src/admin/pricing/matrix/matrixXlsx.js (the «Productos y precios» workbook
// and its import mapping).
//
//   node apps/capri-storefront/scripts/test-xlsx.mjs
//
// 1. write the matrix workbook → read it back → no changes detected
// 2. edit cells in the read rows (price, discount, cost, clear exact) → only those changes
// 3. the same file re-zipped with DEFLATE + shared strings (what Excel saves) reads the same
// 4. the legacy downloadXlsx/buildXlsx path still builds and reads
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { buildStyledXlsx, buildXlsx, readXlsx, unzip, inkOn, tint } from "../src/admin/exportXlsx.js";
import { matrixWorkbook, workbookToImport, mapColumns, KEY_HEADER } from "../src/admin/pricing/matrix/matrixXlsx.js";
import { promoOf } from "../src/admin/pricing/promo.js";
import { parseInput, filterGroups, groupStats, validateFrameForm, validateTreatmentForm, replaceRow, patchSiblingCost } from "../src/admin/pricing/matrix/model.js";

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n${e.stack}`); process.exitCode = 1; }
};

const t = (k, p) => (p ? `${k}${JSON.stringify(p)}` : ({
  "adm.pm.col.brand": "Marca", "adm.pm.col.model": "Modelo", "adm.pm.col.sku": "SKU", "adm.pm.col.cost": "Costo",
  "adm.pm.col.design": "Diseño", "adm.pm.col.material": "Material", "adm.pm.col.key": "Clave", "adm.pm.col.family": "Familia",
  "adm.pm.col.treatment": "Tratamiento", "adm.pm.col.price": "Precio", "adm.pm.col.discount": "Desc %", "adm.pm.col.final": "Final",
  "adm.pm.sub.frames": "Monturas", "adm.pm.sub.cases": "Estuches", "adm.pm.sub.lenses": "Lentes", "adm.pm.sub.treatments": "Tratamientos",
  "adm.pm.xlsx.cover": "Portada",
}[k] || k));

const STORES = [
  { id: "est_1", code: "Op1", name: "Katy", color: "#2E7D32" },
  { id: "est_2", code: "Op2", name: "El Rancho", color: "#FDE68A" },
];
const cell = (price, extra = {}) => ({ price_cents: price, source: "rule", exact: false, discount_pct: 0, final_cents: price, exposed: true, ...extra });
const SECTIONS = {
  frames: { section: "frames", cost_access: true, stores: STORES, groups: [
    { key: "di-caprio", label: "Di Caprio", kind: "brand", rows: [
      { kind: "frame", key: "prod_dc407", product_id: "prod_dc407", sku: "DC407", title: "DC407", cost_cents: 1650, cost_source: "supplier_list",
        stores: { est_1: cell(6000, { source: "store_exact", exact: true, discount_pct: 10, final_cents: 5400 }), est_2: cell(6297) } },
      { kind: "frame", key: "prod_dc409", product_id: "prod_dc409", sku: "DC409", title: "DC409 «Ñandú» & <co>", cost_cents: null,
        stores: { est_1: cell(4997), est_2: cell(5297, { exposed: false }) } },
    ] },
  ] },
  lenses: { section: "lenses", cost_access: true, stores: STORES, groups: [
    { key: "sv", label: "Visión sencilla", kind: "design", rows: [
      { kind: "lens", key: "sv:cr39", title: "CR-39 · stock", cost_cents: 800, cost_source: "lab", stores: { est_1: cell(4000), est_2: cell(4200) } },
    ] },
  ] },
  treatments: { section: "treatments", cost_access: true, stores: STORES, groups: [
    { key: "ar", label: "Antirreflejo", kind: "family", rows: [
      { kind: "ar", key: "ar-green-basic", title: "AR Green", cost_cents: 300, cost_source: "lab", stores: { est_1: cell(2500), est_2: cell(2500, { discount_pct: 20, final_cents: 2000 }) } },
    ] },
  ] },
};
const NOW = new Date("2026-11-06T15:30:00Z");
const book = () => buildStyledXlsx(matrixWorkbook({ sections: SECTIONS, stores: STORES, costAccess: true, who: "Rubí", now: NOW, t, fmtDate: (d) => d.toISOString() }));

/** Re-zip every entry with DEFLATE and move inline strings to sharedStrings, like Excel does on save. */
async function asExcelWouldSave(bytes) {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const shared = [];
  const out = {};
  for (const [name, data] of Object.entries(files)) {
    let text = dec.decode(data);
    if (/^xl\/worksheets\//.test(name)) {
      text = text.replace(/<c r="([A-Z]+\d+)" t="inlineStr"([^>]*)><is><t xml:space="preserve">([\s\S]*?)<\/t><\/is><\/c>/g, (m, ref, rest, v) => {
        shared.push(v);
        return `<c r="${ref}" t="s"${rest}><v>${shared.length - 1}</v></c>`;
      });
    }
    out[name] = text;
  }
  out["xl/sharedStrings.xml"] = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}">${shared.map((s, i) => (i % 2 ? `<si><r><t>${s.slice(0, 2)}</t></r><r><t xml:space="preserve">${s.slice(2)}</t></r></si>` : `<si><t>${s}</t></si>`)).join("")}</sst>`;
  // Minimal zip writer with method 8.
  const enc = new TextEncoder();
  const parts = []; const central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255]; const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of Object.entries(out)) {
    const nb = enc.encode(name); const raw = enc.encode(text); const comp = deflateRawSync(raw);
    const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0), ...u32(comp.length), ...u32(raw.length), ...u16(nb.length), ...u16(0)]);
    parts.push(head, nb, comp);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0), ...u32(comp.length), ...u32(raw.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nb);
    offset += head.length + nb.length + comp.length;
  }
  const cd = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(out).length), ...u16(Object.keys(out).length), ...u32(cd), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end]; const total = all.reduce((n, b) => n + b.length, 0);
  const res = new Uint8Array(total); let p = 0; for (const b of all) { res.set(b, p); p += b.length; }
  return res;
}

console.log("xlsx round-trip");

await test("styled workbook has cover + 3 section sheets, styles, merges, freeze, autofilter", async () => {
  const files = await unzip(book());
  const dec = new TextDecoder();
  const wb = dec.decode(files["xl/workbook.xml"]);
  assert.match(wb, /<sheet name="Portada"/);
  assert.match(wb, /<sheet name="Monturas"/);
  assert.match(wb, /_xlnm\._FilterDatabase/);
  const styles = dec.decode(files["xl/styles.xml"]);
  assert.match(styles, /formatCode="\$#,##0\.00"/);
  assert.match(styles, /formatCode="0\.0%"/);
  assert.match(styles, /FF2E7D32/); // store color fill
  const s2 = dec.decode(files["xl/worksheets/sheet2.xml"]);
  assert.match(s2, /<pane xSplit="4" ySplit="3" topLeftCell="E4" activePane="bottomRight" state="frozen"\/>/);
  assert.match(s2, /<mergeCell ref="E2:G2"\/>/);
  assert.match(s2, /<autoFilter ref="A3:/);
  assert.match(s2, /<f>ROUND\(E5\*\(1-F5\),2\)<\/f>/);
  assert.match(s2, /hidden="1"/);
});

await test("inkOn / tint", () => {
  assert.equal(inkOn("#FDE68A"), "#111827");
  assert.equal(inkOn("#1B1F3A"), "#FFFFFF");
  assert.equal(tint("#000000", 0.5), "#808080");
});

await test("read back: values, escaped text, header mapping", async () => {
  const read = await readXlsx(book());
  assert.deepEqual(read.map((s) => s.name), ["Portada", "Monturas", "Lentes", "Tratamientos"]);
  const frames = read[1];
  const map = mapColumns(frames.rows, ["Op1", "Op2"]);
  assert.equal(map.headerRow, 1);
  assert.equal(map.base.cost, 3);
  assert.deepEqual(map.stores.map((s) => [s.code, s.price, s.discount]), [["Op1", 4, 5], ["Op2", 7, 8]]);
  assert.equal(frames.rows[4][1], "DC407");
  assert.equal(frames.rows[4][4], 60);
  assert.equal(frames.rows[4][5], 0.1);
  assert.equal(frames.rows[4][6], 54);
  assert.equal(frames.rows[5][1], "DC409 «Ñandú» & <co>");
  assert.equal(frames.rows[4][map.base.key], "frames|prod_dc407");
  assert.equal(frames.rows[1][map.base.key], KEY_HEADER);
});

await test("untouched file → no changes", async () => {
  const out = workbookToImport(await readXlsx(book()), { current: SECTIONS, stores: STORES });
  assert.equal(out.sheets, 3);
  assert.equal(out.rows.length, 0, JSON.stringify(out.rows));
  assert.equal(out.unchanged, 4);
  assert.deepEqual(out.problems, []);
});

await test("edits → only the changed cells, in contract shape", async () => {
  const read = await readXlsx(book());
  const fr = read[1].rows;
  fr[4][4] = null; // clear the exact price of Op1 → back to the rule
  fr[4][8] = 0.15; // Op2 discount 15 % (percent cell = fraction)
  fr[5][3] = 17.5; // cost of DC409 (had none)
  fr[5][7] = "55"; // Op2 price typed as text
  const ln = read[2].rows;
  ln[4][5] = 12; // Op1 discount typed as a plain number = 12 %
  const tr = read[3].rows;
  tr[4][8] = null; // Op2 discount cleared
  const out = workbookToImport(read, { current: SECTIONS, stores: STORES });
  const by = Object.fromEntries(out.rows.map((r) => [r.sku || r.key, r]));
  assert.deepEqual(by.DC407, { section: "frames", sku: "DC407", stores: { Op1: { price: null }, Op2: { discount: 15 } } });
  assert.deepEqual(by.DC409, { section: "frames", sku: "DC409", cost: 17.5, stores: { Op2: { price: 55 } } });
  assert.deepEqual(by["sv:cr39"], { section: "lenses", key: "sv:cr39", stores: { Op1: { discount: 12 } } });
  assert.deepEqual(by["ar-green-basic"], { section: "treatments", key: "ar-green-basic", stores: { Op2: { discount: null } } });
  assert.equal(out.rows.length, 4);
});

await test("DEFLATE + sharedStrings (as Excel saves) reads identically", async () => {
  const plain = await readXlsx(book());
  const excel = await readXlsx(await asExcelWouldSave(book()));
  assert.deepEqual(excel, plain);
});

await test("bad values and unknown stores are reported", async () => {
  const read = await readXlsx(book());
  read[1].rows[4][4] = "sesenta";
  read[1].rows[1][4] = "Op9 · Nueva";
  const out = workbookToImport(read, { current: SECTIONS, stores: STORES });
  assert.deepEqual(out.unknownStores, ["Op9"]);
  const out2 = workbookToImport(await readXlsx(book()).then((r) => { r[1].rows[4][7] = "abc"; return r; }), { current: SECTIONS, stores: STORES });
  assert.equal(out2.problems.length, 1);
  assert.equal(out2.problems[0].reason, "bad_value");
});

await test("legacy buildXlsx still builds and reads", async () => {
  const bytes = buildXlsx([{ name: "Ventas", cols: [{ header: "Día", key: "d" }, { header: "Total", key: "v", type: "money" }], rows: [{ d: "2026-11-01", v: 12.5 }], totals: { v: 12.5 } }]);
  const [s] = await readXlsx(bytes);
  assert.equal(s.name, "Ventas");
  assert.deepEqual(s.rows[0], ["Día", "Total"]);
  assert.deepEqual(s.rows[1], ["2026-11-01", 12.5]);
  assert.deepEqual(s.rows[2], ["Total", 12.5]);
});

await test("model helpers: parseInput, filters, stats, form validation", () => {
  assert.equal(parseInput("$1,234.50"), 1234.5);
  assert.equal(parseInput("54,5"), 54.5);
  assert.equal(parseInput("10%"), 10);
  assert.equal(parseInput(""), null);
  assert.equal(parseInput("abc"), undefined);
  const g = SECTIONS.frames.groups;
  assert.equal(filterGroups(g, { filters: new Set(["exact"]), storeIds: ["est_1", "est_2"] })[0].rows.length, 1);
  assert.equal(filterGroups(g, { filters: new Set(["nocost"]), storeIds: ["est_1"] })[0].rows[0].sku, "DC409");
  assert.equal(filterGroups(g, { q: "nandu", storeIds: [] })[0].rows[0].sku, "DC409");
  const st = groupStats(g[0], ["est_1", "est_2"]);
  assert.equal(st.count, 2);
  assert.equal(st.avgCostCents, 1650);
  assert.equal(st.perStore.est_2.exposed, 1);
  const f = validateFrameForm({ brand: "", sku: "DC 407", colors: [{ name: "" }], eye_size: "200", cost: "-1" }, { takenSkus: new Set(["DC407"]) });
  assert.deepEqual(f.errors, { brand: "bad_brand", sku: "sku_taken", colors: "bad_colors", eye_size: "bad_measure", cost: "bad_value" });
  const ok = validateFrameForm({ brand: "Di Caprio Kids", sku: "DK1", colors: [{ name: "Negro", image: "https://x/y.jpg" }], eye_size: "48", cost: "12" }, { stores: STORES });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.body.brand_slug, "di-caprio-kids");
  const tr = validateTreatmentForm({ type: "photo", label_es: "A", label_en: "", prices: {} });
  assert.deepEqual(tr.errors, { label_en: "bad_label", prices: "bad_value" });
});

await test("promoOf: single part, mixed parts, none", () => {
  assert.deepEqual(promoOf({ list: 54, promo: { frame_pct: 10, lens_pct: 0, before_cents: 6000 } }), { before: 60, pct: 10 });
  assert.deepEqual(promoOf({ list: 150, promo: { frame_pct: 10, lens_pct: 30, before_cents: 200000 / 10 } }), { before: 200, pct: 25 });
  assert.equal(promoOf({ list: 60 }), null);
  assert.equal(promoOf({ list: 60, promo: { frame_pct: 0, before_cents: 6000 } }), null);
});

await test("promoOf: the printed document's DocLine.promo (before in dollars + pct)", () => {
  // lib/pos-documents.ts sends { before, pct, frame_pct, … } — the receipts read this shape.
  assert.deepEqual(promoOf({ list: 68.31, promo: { before: 75.9, pct: 10, frame_pct: 10, lens_pct: null, photo_pct: null, ar_pct: null } }), { before: 75.9, pct: 10 });
  assert.deepEqual(promoOf({ list: 140, promo: { before: 160, pct: 12.5, frame_pct: 10, lens_pct: 20 } }), { before: 160, pct: 12.5 });
  assert.equal(promoOf({ list: 60, promo: { before: 0, pct: 10 } }), null);
});

await test("replaceRow replaces the row (no stale flags) and filterGroups skips unpriced digital cells in «Sin costo»", () => {
  const groups = [{ key: "sv", rows: [{ key: "sv:poly:digital", available: false, cost_cents: null, stores: {} }, { key: "sv:poly", cost_cents: null, stores: {} }] }];
  const next = replaceRow(groups, { key: "sv:poly:digital", cost_cents: null, master_cents: 12000, stores: {} });
  assert.equal(next[0].rows[0].available, undefined);
  assert.equal(next[0].rows[0].master_cents, 12000);
  assert.equal(next[0].rows[1], groups[0].rows[1]);
  const f = filterGroups(groups, { filters: new Set(["nocost"]) });
  assert.deepEqual(f[0].rows.map((r) => r.key), ["sv:poly"]);
});

await test("patchSiblingCost: one photochromic cost shows on all its category rows", () => {
  const groups = [{ key: "photo", rows: [
    { key: "photo-grey:sv", kind: "photo", code: "photo-grey", cost_cents: 2500, stores: {} },
    { key: "photo-grey:prog", kind: "photo", code: "photo-grey", cost_cents: null, stores: {} },
    { key: "photo-brown:prog", kind: "photo", code: "photo-brown", cost_cents: null, stores: {} },
  ] }];
  const next = patchSiblingCost(groups, { key: "photo-grey:sv", kind: "photo", code: "photo-grey", cost_cents: 2500, cost_source: "owner_edit" });
  assert.equal(next[0].rows[1].cost_cents, 2500);
  assert.equal(next[0].rows[2].cost_cents, null);
});

console.log(process.exitCode ? "xlsx tests FAILED" : `xlsx tests passed (${passed})`);
