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
// 5. v2: the «Marcas» sheet (brand price / discount per store) round-trips with 0 changes
//    and its edits become `section: "brands"` rows; v2 model helpers
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { buildStyledXlsx, buildXlsx, readXlsx, unzip, inkOn, tint } from "../src/admin/exportXlsx.js";
import { matrixWorkbook, workbookToImport, mapColumns, KEY_HEADER } from "../src/admin/pricing/matrix/matrixXlsx.js";
import { promoOf } from "../src/admin/pricing/promo.js";
import {
  parseInput, filterGroups, groupStats, validateFrameForm, validateTreatmentForm, replaceRow, patchSiblingCost,
  brandCell, withRegistry, sourceTone, costTone, validateBrandForm, frameToForm, rowPrices, monogram, attrSlug, replaceGroup, removeRow, treatmentCode,
} from "../src/admin/pricing/matrix/model.js";

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
  "adm.pm.xlsx.cover": "Portada", "adm.pm.sub.brands": "Marcas", "adm.pm.col.kind": "Tipo", "adm.pm.col.models": "Modelos",
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
  // QA v2: a frame −20 % with lenses at full price is −10 % of the line (what the receipt prints).
  assert.deepEqual(promoOf({ list: 126, promo: { frame_pct: 20, lens_pct: null, photo_pct: null, ar_pct: null, before_cents: 14000 } }), { before: 140, pct: 10 });
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

await test("export titles lens cells, treatments and groups in the panel language (not the server's Spanish codes)", async () => {
  const tt = (k) => ({ "adm.price.lens.finish.stock": "Stock", "adm.price.lens.finish.digital": "Digital surfaced", "adm.price.lenses.cat.sv": "Single vision", "adm.pm.grp.photo": "Photochromic", "adm.pm.grp.cases": "Cases" }[k] || t(k));
  const sections = {
    lenses: { groups: [{ key: "sv", kind: "design", label: "Visión Sencilla", label_en: "Single Vision", rows: [
      { kind: "lens", key: "sv:cr39", title: "CR-39 (Resina) · stock", material_label_es: "CR-39 (Resina)", material_label_en: "CR-39 (Resin)", finish: "stock", stores: { est_1: cell(4000), est_2: cell(4000) } },
    ] }] },
    treatments: { groups: [{ key: "photo", kind: "treatment", label: "Fotocromáticos", rows: [
      { kind: "photo", key: "photo-grey:sv", title: "Fotocromático Grey · sv", label_es: "Fotocromático Grey", label_en: "Photochromic Grey", category: "sv", stores: { est_1: cell(9000), est_2: cell(9000) } },
    ] }] },
  };
  const read = await readXlsx(buildStyledXlsx(matrixWorkbook({ sections, stores: STORES, t: tt, lang: "en" })));
  const cellsOf = (sheet) => sheet.rows.flat().map(String);
  const lens = cellsOf(read[1]), tr = cellsOf(read[2]);
  assert.ok(lens.includes("Single Vision  (1)") && lens.includes("CR-39 (Resin) · Stock"), lens.join("|"));
  assert.ok(tr.includes("Photochromic  (1)") && tr.includes("Photochromic Grey · Single vision"), tr.join("|"));
  assert.ok(!tr.some((v) => / · sv$/.test(v)) && !lens.some((v) => / · stock$/.test(v)));
  // the keys still identify the rows: re-reading gives no changes
  const out = workbookToImport(read, { current: sections, stores: STORES });
  assert.deepEqual(out.problems, []);
  assert.equal(out.rows.length, 0, JSON.stringify(out.rows));
  assert.equal(out.unchanged, 2);
});


/* ───────── v2: «Marcas» sheet and helpers ───────── */
const bstores = (a, b) => ({ est_1: { brand_rule: null, exposed_rows: 1, brand_price_cents: a?.[0] ?? null, brand_discount_pct: a?.[1] ?? null }, est_2: { brand_rule: null, exposed_rows: 1, brand_price_cents: b?.[0] ?? null, brand_discount_pct: b?.[1] ?? null } });
const V2 = {
  frames: { section: "frames", cost_access: true, stores: STORES, groups: [
    { key: "di-caprio", label: "Di Caprio", kind: "brand", stores: bstores([6500, null], [null, 15]), rows: [
      { kind: "frame", key: "prod_dc407", product_id: "prod_dc407", sku: "DC407", title: "DC407", cost_cents: 1650, cost_source: "supplier_list",
        stores: { est_1: cell(6500, { source: "brand" }), est_2: cell(6297, { discount_pct: 15, final_cents: 5352 }) } },
    ] },
    { key: "flexure", label: "Flexure", kind: "brand", stores: bstores(null, null), rows: [
      { kind: "frame", key: "prod_fx1", product_id: "prod_fx1", sku: "FX1", title: "FX1", cost_cents: 1200, cost_source: "supplier_list_prev", stores: { est_1: cell(4000), est_2: cell(4000) } },
    ] },
  ] },
  cases: { section: "cases", cost_access: true, stores: STORES, groups: [
    { key: "case", label: "Cases", kind: "brand", stores: bstores(null, [1500, null]), rows: [
      { kind: "case", key: "prod_cs1", product_id: "prod_cs1", sku: "CS1", title: "Estuche", cost_cents: 180, cost_source: "supplier_list", stores: { est_1: cell(597), est_2: cell(1500, { source: "brand" }) } },
    ] },
  ] },
};
const v2book = () => buildStyledXlsx(matrixWorkbook({ sections: V2, stores: STORES, costAccess: true, who: "Rubí", now: NOW, t, fmtDate: (d) => d.toISOString() }));

await test("v2: «Marcas» sheet — last sheet, brand price bold, hidden _key per brand and scope", async () => {
  const read = await readXlsx(v2book());
  assert.deepEqual(read.map((x) => x.name), ["Portada", "Monturas", "Estuches", "Marcas"]);
  const br = read[3].rows;
  assert.deepEqual(br[1].slice(0, 5), ["Tipo", "Marca", "Clave", "Modelos", "Op1 · Katy"]);
  assert.deepEqual(br[2].slice(4, 8), ["Precio", "Desc %", "Precio", "Desc %"]);
  assert.deepEqual(br[3].slice(0, 8), ["Monturas", "Di Caprio", "di-caprio", 1, 65, null, null, 0.15]);
  assert.equal(br[3][8], "brands|frame:di-caprio");
  assert.equal(br[5][8], "brands|case:case");
  assert.equal(br[5][6], 15);
  const files = await unzip(v2book());
  const s4 = new TextDecoder().decode(files["xl/worksheets/sheet4.xml"]);
  assert.match(s4, /<mergeCell ref="E2:F2"\/>/);
  assert.match(s4, /<pane xSplit="4" ySplit="3"/);
});

await test("v2: untouched book with «Marcas» → 0 changes", async () => {
  const out = workbookToImport(await readXlsx(v2book()), { current: V2, stores: STORES });
  assert.deepEqual(out.problems, []);
  assert.equal(out.rows.length, 0, JSON.stringify(out.rows));
  assert.equal(out.unchanged, 3 + 3);
});

await test("v2: brand edits → section «brands» rows with scope, only what changed", async () => {
  const read = await readXlsx(v2book());
  const br = read[3].rows;
  br[3][4] = 70; // Di Caprio Op1 brand price 65 → 70
  br[3][7] = null; // Di Caprio Op2 brand discount 15 % → cleared
  br[4][5] = 0.2; // Flexure Op1 discount 20 %
  br[5][6] = null; // Cases Op2 brand price cleared
  br.push(["", "Peachtree", "peachtree", 0, 55]); // a brand typed by hand, no _key
  const out = workbookToImport(read, { current: V2, stores: STORES });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.rows, [
    { section: "brands", key: "di-caprio", scope: "frame", stores: { Op1: { price: 70 }, Op2: { discount: null } } },
    { section: "brands", key: "flexure", scope: "frame", stores: { Op1: { discount: 20 } } },
    { section: "brands", key: "case", scope: "case", stores: { Op2: { price: null } } },
    { section: "brands", key: "peachtree", scope: "frame", stores: { Op1: { price: 55 } } },
  ]);
  assert.deepEqual(out.origins.map((o) => o.sheet), ["Marcas", "Marcas", "Marcas", "Marcas"]);
});

await test("v2 helpers: brandCell, withRegistry, source / cost tones, monogram, attrSlug", () => {
  const g = V2.frames.groups[0];
  assert.deepEqual(brandCell(g, "est_1"), { priceCents: 6500, pct: null });
  assert.deepEqual(brandCell(g, "est_2"), { priceCents: null, pct: 15 });
  assert.deepEqual(brandCell(null, "x"), { priceCents: null, pct: null });
  const reg = [
    { slug: "di-caprio", name: "Di Caprio", logo_url: "/brands/logo-di-caprio.png", kind: "frame", models: 1 },
    { slug: "peachtree", name: "Peachtree", logo_url: null, kind: "frame", models: 0 },
    { slug: "gone", name: "Gone", kind: "frame", models: 0, active: false },
    { slug: "trendy", name: "Trendy", kind: "case", models: 0 },
  ];
  const v = withRegistry(V2.frames.groups, reg, "frames");
  assert.equal(v[0].logo_url, "/brands/logo-di-caprio.png");
  assert.deepEqual(v.map((x) => x.key), ["di-caprio", "flexure", "peachtree"]);
  assert.equal(v[2].empty, true);
  assert.deepEqual(withRegistry(V2.cases.groups, reg, "cases").map((x) => x.key), ["case", "trendy"]);
  assert.equal(withRegistry([{ key: "sv", kind: "design", rows: [] }], reg, "lenses").length, 1);
  assert.deepEqual(["store_exact", "brand", "rule", "band", "master", "base", undefined].map(sourceTone), ["exact", "brand", "rule", "band", "master", "master", "master"]);
  assert.deepEqual(["supplier_list", "supplier_list_prev", "owner_edit", "lab", null].map(costTone), ["c2026", "prev", "own", "lab", null]);
  assert.equal(monogram("Di Caprio"), "DC");
  assert.equal(monogram("flexure"), "FL");
  assert.equal(attrSlug("shape", "Ojo de gato"), "cat-eye");
  assert.equal(attrSlug("material", ["acetate"]), "acetate");
  assert.equal(attrSlug("style", "full-rim"), "full-frame");
  const gs = [{ key: "a", rows: [{ key: "r1" }, { key: "r2" }] }];
  assert.deepEqual(removeRow(gs, "r1")[0].rows.map((r) => r.key), ["r2"]);
  assert.equal(replaceGroup(gs, { key: "a", label: "A" })[0].rows.length, 2);
  assert.equal(treatmentCode({ key: "photo-grey:sv" }), "photo-grey");
});

await test("v2 forms: brand, model edit (Medusa fallback), only changed store prices travel", () => {
  assert.deepEqual(validateBrandForm({ name: "Di Caprio" }, { takenSlugs: new Set(["di-caprio"]) }).errors, { name: "brand_taken" });
  assert.deepEqual(validateBrandForm({ name: "Nueva", kind: "case", logo_url: "https://cdn/x.png" }).body, { name: "Nueva", kind: "case", logo_url: "https://cdn/x.png" });
  assert.deepEqual(validateBrandForm({ name: "X", logo_url: "ftp://x" }).errors, { logo_url: "bad_image" });
  assert.deepEqual(validateBrandForm({ name: "Ren", logo_url: "", active: false }, { editing: true }).body, { name: "Ren", logo_url: null, active: false });
  // Medusa's product as the edit form's source (no GET /admin/catalog/frames/:id yet).
  const product = { product: { id: "prod_1", title: "DC 50", description: "Linda", images: [{ url: "https://cdn/a.jpg" }, { url: "https://cdn/side.jpg" }],
    variants: [{ id: "var_1", title: "Black", sku: "DC50", metadata: { image: "https://cdn/a.jpg" } }],
    metadata: { brand: "Di Caprio", brand_slug: "di-caprio", eye_size: 52, bridge_size: 18, temple_length: 140, material: "acetate", shape: "cat-eye", gender: "women", age_group: "adult", features: ["Spring Hinge"], a: 52 } } };
  const row = { key: "prod_1", product_id: "prod_1", sku: "DC50", title: "DC 50", cost_cents: 1650, stores: { est_1: { price_cents: 6000, source: "store_exact", exact: true, discount_pct: 10 }, est_2: { price_cents: 5000, source: "rule", discount_pct: null } } };
  const f = frameToForm(product, row);
  assert.equal(f.brandSlug, "di-caprio");
  assert.equal(f.model, "DC 50");
  assert.deepEqual(f.colors, [{ id: "var_1", name: "Black", image: "https://cdn/a.jpg" }]);
  assert.deepEqual(f.images, ["https://cdn/side.jpg"]);
  assert.equal(f.shape, "cat-eye");
  assert.equal(f.eye_size, "52");
  assert.equal(f.a, "52");
  assert.equal(f.cost, "16.50");
  const init = rowPrices(row, STORES);
  assert.deepEqual(init, { est_1: { price: 60, discount: 10 }, est_2: { price: null, discount: 0 } });
  const prices = { est_1: { price: "60", discount: "10" }, est_2: { price: "55", discount: "" } };
  const { errors, body } = validateFrameForm({ ...f, brand: "Di Caprio", editing: true, prices, description: "" }, { stores: STORES, initialPrices: init });
  assert.deepEqual(errors, {});
  assert.deepEqual(body.prices, { est_2: { price: 55, discount: 0 } });
  // The contract names the kept colour `variant_id` (an `id` made the server re-create it — QA v2).
  assert.deepEqual(body.colors, [{ variant_id: "var_1", name: "Black", image: "https://cdn/a.jpg" }]);
  assert.equal(body.material, "acetate");
  assert.equal(body.description, ""); // emptied on purpose: it travels to clear it
  assert.equal(body.b, undefined); // B was never set: it does not travel
  assert.equal(body.style, undefined);
  const bad = validateFrameForm({ brand: "X", sku: "X1", colors: [{ name: "N" }], images: ["nope"], a: "500" }, { stores: [] });
  assert.deepEqual(bad.errors, { images: "bad_image", a: "bad_measure" });
  assert.deepEqual(validateTreatmentForm({ type: "ar", label_es: "AR", label_en: "AR", cost: "3", ar_group: "sv" }, { editing: true }).body, { label_es: "AR", label_en: "AR", cost: 3, ar_group: "sv" });
});

console.log(process.exitCode ? "xlsx tests FAILED" : `xlsx tests passed (${passed})`);
