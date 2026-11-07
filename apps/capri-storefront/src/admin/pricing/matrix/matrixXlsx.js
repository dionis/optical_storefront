// Excel of «Productos y precios»: the workbook the owner downloads AND reads
// back to import. Pure (no React, no network, no i18n hook — `t` is passed in),
// so scripts/test-xlsx.mjs can round-trip it in Node.
//
// Layout of each section sheet (Monturas, Estuches, Lentes, Tratamientos):
//   row 1  title of the section
//   row 2  Marca | Modelo | SKU | Costo | «Op1 · Katy» (merged ×3, store color) … | _key (hidden)
//   row 3                                 Precio | Desc % | Final           …
//   row 4… one bold group row per brand / design / family, then its articles.
// `_key` (hidden column) = "<section>|<row key>" — how the import finds the row
// even if the owner retouches the visible SKU or title. Group rows have no key.
import { colName, inkOn, tint } from "../../exportXlsx.js";
import { MATRIX_SECTIONS, norm, parseInput, usd } from "./model.js";

export const KEY_HEADER = "_key";

const GROUP_LABEL = { frames: "adm.pm.col.brand", cases: "adm.pm.col.brand", lenses: "adm.pm.col.design", treatments: "adm.pm.col.family" };
const TITLE_LABEL = { frames: "adm.pm.col.model", cases: "adm.pm.col.model", lenses: "adm.pm.col.material", treatments: "adm.pm.col.treatment" };
const SKU_LABEL = { frames: "adm.pm.col.sku", cases: "adm.pm.col.sku", lenses: "adm.pm.col.key", treatments: "adm.pm.col.key" };
export const SHEET_LABEL = { frames: "adm.pm.sub.frames", cases: "adm.pm.sub.cases", lenses: "adm.pm.sub.lenses", treatments: "adm.pm.sub.treatments" };

const NAVY = "#1B1F3A";
const LINE = "#D5D9E2";
const S = {
  title: { bold: true, size: 14, color: NAVY },
  sub: { italic: true, color: "#646B7C" },
  head: { bold: true, fill: "#1B1F3A", color: "#FFFFFF", border: true, align: "left", wrap: true },
  headR: { bold: true, fill: "#1B1F3A", color: "#FFFFFF", border: true, align: "right", wrap: true },
  group: { bold: true, fill: "#EEF0F6", color: NAVY, border: true },
  text: { border: true },
  muted: { border: true, color: "#646B7C" },
  money: { border: true, numFmt: "money" },
  moneyBold: { border: true, numFmt: "money", bold: true },
  moneyOff: { border: true, numFmt: "money", italic: true, color: "#98A0B1" },
  pct: { border: true, numFmt: "pct" },
  final: { border: true, numFmt: "money", fill: "#F8F9FB" },
};
void LINE;

/** Store header label, as written in row 2 and parsed back on import: "Op1 · Katy". */
export const storeHeader = (s) => [s.code, s.name].filter(Boolean).join(" · ");

/**
 * The whole workbook: cover + one sheet per section present in `sections`.
 * @param sections { frames?: payload, cases?, lenses?, treatments? } (GET /admin/pricing/matrix)
 * @param stores   [{ id, code, name, color }] — the store columns, in order
 * @param costAccess boolean — without it there is no cost column at all
 * @param who      who exported (cover)
 * @param now      Date (cover)
 * @param t        dictionary function
 * @param fmtDate  (Date) => string, in the panel language
 */
export function matrixWorkbook({ sections, stores, costAccess = true, who = "", now = new Date(), t, fmtDate = (d) => d.toISOString() }) {
  const present = MATRIX_SECTIONS.filter((s) => sections[s]);
  const sheets = [coverSheet({ sections, present, stores, who, now, t, fmtDate })];
  for (const section of present) sheets.push(sectionSheet({ section, data: sections[section], stores, costAccess, t, now, fmtDate }));
  return sheets;
}

function coverSheet({ sections, present, stores, who, now, t, fmtDate }) {
  const rows = [
    { height: 26, cells: [{ v: t("adm.pm.xlsx.title"), s: S.title }] },
    { cells: [{ v: t("adm.pm.xlsx.generated"), s: { bold: true } }, { v: fmtDate(now) }] },
    { cells: [{ v: t("adm.pm.xlsx.by"), s: { bold: true } }, { v: who || "—" }] },
    { cells: [] },
    { cells: [{ v: t("adm.pm.xlsx.stores"), s: S.head }, { v: "", s: S.head }, { v: "", s: S.head }] },
  ];
  for (const s of stores) {
    rows.push({ cells: [
      { v: s.code || "", s: { bold: true, fill: s.color || "#4F5BD5", color: inkOn(s.color || "#4F5BD5"), border: true, align: "center" } },
      { v: s.name || "", s: S.text },
      { v: String(s.color || "").toUpperCase(), s: S.muted },
    ] });
  }
  rows.push({ cells: [] });
  rows.push({ cells: [{ v: t("adm.pm.xlsx.sheets"), s: S.head }, { v: t("adm.pm.xlsx.rows"), s: S.headR }, { v: "", s: S.head }] });
  for (const sec of present) {
    const n = (sections[sec].groups || []).reduce((a, g) => a + (g.rows || []).length, 0);
    rows.push({ cells: [{ v: t(SHEET_LABEL[sec]), s: S.text }, { v: n, s: { border: true, numFmt: "int" } }, { v: "", s: S.text }] });
  }
  rows.push({ cells: [] });
  rows.push({ cells: [{ v: t("adm.pm.xlsx.howTo"), s: { bold: true } }] });
  for (const k of ["adm.pm.xlsx.how1", "adm.pm.xlsx.how2", "adm.pm.xlsx.how3", "adm.pm.xlsx.how4"]) rows.push({ cells: [{ v: `• ${t(k)}`, s: { color: "#3C4257" } }] });
  return {
    name: t("adm.pm.xlsx.cover"),
    gridlines: false,
    cols: [{ width: 22 }, { width: 34 }, { width: 14 }],
    rows,
    merges: [],
  };
}

function sectionSheet({ section, data, stores, costAccess, t, now, fmtDate }) {
  const base = [
    { label: t(GROUP_LABEL[section]), width: 18 },
    { label: t(TITLE_LABEL[section]), width: section === "frames" || section === "cases" ? 18 : 30 },
    { label: t(SKU_LABEL[section]), width: 16 },
    ...(costAccess ? [{ label: t("adm.pm.col.cost"), width: 11, right: true }] : []),
  ];
  const nb = base.length;
  const per = 3; // Precio, Desc %, Final
  const keyCol = nb + stores.length * per;
  const cols = [...base.map((b) => ({ width: b.width })), ...stores.flatMap(() => [{ width: 11 }, { width: 8 }, { width: 11 }]), { width: 24, hidden: true }];

  const r2 = [...base.map((b) => ({ v: b.label, s: b.right ? S.headR : S.head }))];
  const r3 = [...base.map((b) => ({ v: "", s: b.right ? S.headR : S.head }))];
  const merges = base.map((_, i) => `${colName(i)}2:${colName(i)}3`);
  stores.forEach((s, i) => {
    const color = s.color || "#4F5BD5";
    const c0 = nb + i * per;
    const top = { bold: true, fill: color, color: inkOn(color), border: true, align: "center" };
    const soft = tint(color, 0.82);
    const sub = { bold: true, fill: soft, color: inkOn(soft), border: true, align: "right" };
    r2.push({ v: storeHeader(s), s: top }, { v: "", s: top }, { v: "", s: top });
    r3.push({ v: t("adm.pm.col.price"), s: sub }, { v: t("adm.pm.col.discount"), s: sub }, { v: t("adm.pm.col.final"), s: sub });
    merges.push(`${colName(c0)}2:${colName(c0 + per - 1)}2`);
  });
  r2[keyCol] = { v: KEY_HEADER, s: S.muted };
  r3[keyCol] = { v: "", s: S.muted };
  merges.push(`${colName(keyCol)}2:${colName(keyCol)}3`);

  const rows = [
    { height: 22, cells: [{ v: `${t(SHEET_LABEL[section])} · ${fmtDate(now)}`, s: S.title }] },
    { height: 20, cells: r2 },
    { cells: r3 },
  ];
  for (const g of data.groups || []) {
    const gr = [{ v: `${g.label}  (${(g.rows || []).length})`, s: S.group }];
    for (let i = 1; i < keyCol; i++) gr.push({ v: "", s: S.group });
    rows.push({ cells: gr });
    merges.push(`A${rows.length}:${colName(nb - 1)}${rows.length}`);
    for (const r of g.rows || []) {
      const n = rows.length + 1;
      const cells = [
        { v: g.label, s: S.muted },
        { v: r.title || "", s: S.text },
        { v: r.sku || r.key || "", s: S.muted },
      ];
      if (costAccess) cells.push({ v: usd(r.cost_cents), s: S.money });
      stores.forEach((s, i) => {
        const cell = r.stores?.[s.id] || {};
        const c0 = nb + i * per;
        const price = usd(cell.price_cents);
        const pct = Number(cell.discount_pct) || 0;
        const off = cell.exposed === false;
        cells.push({ v: price, s: off ? S.moneyOff : cell.exact || cell.source === "store_exact" ? S.moneyBold : S.money });
        cells.push({ v: pct > 0 ? pct / 100 : null, s: S.pct });
        const fin = cell.final_cents != null ? usd(cell.final_cents) : price == null ? null : Math.round(price * (1 - pct / 100) * 100) / 100;
        cells.push(price == null ? { v: null, s: S.final } : { v: fin, f: `ROUND(${colName(c0)}${n}*(1-${colName(c0 + 1)}${n}),2)`, s: S.final });
      });
      cells[keyCol] = { v: `${section}|${r.key}`, s: S.muted };
      rows.push({ cells });
    }
  }
  return {
    name: t(SHEET_LABEL[section]),
    cols,
    rows,
    merges,
    freeze: { row: 3, col: nb },
    autoFilter: `A3:${colName(keyCol - 1)}${Math.max(3, rows.length)}`,
  };
}

/* ───────────────────────── Import ───────────────────────── */

// Header words in both languages (matching tokens, not UI copy).
const BASE_WORDS = {
  group: ["marca", "brand", "diseno", "design", "familia", "family", "grupo", "group", "coleccion", "collection"],
  title: ["modelo", "model", "material", "tratamiento", "treatment", "articulo", "item", "producto", "product"],
  sku: ["sku", "clave", "key", "codigo", "code"],
  cost: ["costo", "cost", "coste"],
};
const FIELD_WORDS = { price: ["precio", "price"], discount: ["desc", "disc", "promo"], final: ["final"] };
const starts = (text, words) => words.some((w) => text === w || text.startsWith(`${w} `) || text.startsWith(w));

/**
 * Columns of one read sheet: { headerRow, base: { group, title, sku, cost, key },
 * stores: [{ code, price, discount }] } or null when the sheet is not a matrix
 * sheet (the cover, or something else the owner added).
 */
export function mapColumns(rows, storeCodes) {
  const codes = new Map(storeCodes.map((c) => [norm(c), c]));
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i] || [];
    if (r.some((v) => norm(v) === KEY_HEADER) || (r.some((v) => starts(norm(v), BASE_WORDS.sku)) && r.some((v) => codes.has(norm(String(v ?? "").split("·")[0]).trim())))) { h = i; break; }
  }
  if (h < 0) return null;
  const top = rows[h] || [];
  const sub = rows[h + 1] || [];
  const width = Math.max(top.length, sub.length);
  const base = {};
  const stores = new Map();
  let carry = null; // store code of a merged header spanning several columns
  for (let c = 0; c < width; c++) {
    const head = String(top[c] ?? "").trim();
    const field = norm(sub[c]);
    if (head) {
      const n = norm(head);
      if (n === KEY_HEADER) { base.key = c; carry = null; continue; }
      const code = codes.get(norm(head.split("·")[0]).trim()) || codes.get(n.split(/\s+/)[0]);
      if (code) carry = code;
      else {
        carry = null;
        for (const [k, words] of Object.entries(BASE_WORDS)) if (base[k] == null && starts(n, words)) { base[k] = c; break; }
        continue;
      }
    }
    // A sub-header that names its own store ("Op1 Precio") wins over the carry.
    const own = [...codes.entries()].find(([k]) => field.split(/\s+/).includes(k));
    const code = own ? own[1] : carry;
    if (!code) continue;
    const f = field.replace(own ? own[0] : "", "").trim();
    const kind = Object.entries(FIELD_WORDS).find(([, words]) => starts(f, words))?.[0];
    if (!kind || kind === "final") continue;
    if (!stores.has(code)) stores.set(code, { code });
    stores.get(code)[kind] = c;
  }
  return { headerRow: h, dataRow: h + 2, base, stores: [...stores.values()] };
}

const pctIn = (v) => {
  const n = typeof v === "number" ? v : parseInput(v);
  if (n == null || n === undefined) return n;
  // Percent-formatted cells hold a fraction (0.1 = 10 %); plain cells hold the number.
  return n < 1 && n > 0 ? Math.round(n * 10000) / 100 : n;
};
const moneyIn = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : parseInput(v));
const blank = (v) => v == null || String(v).trim() === "";

/**
 * Read workbook → the `rows` of POST /admin/pricing/matrix/import, with ONLY
 * what changed against `current` (the matrix as it is now). An exported price
 * equal to today's effective price is left out: re-importing an untouched
 * file must not turn every rule price into a fixed one. An emptied price
 * cell clears an exact price (back to the rule); an emptied discount clears
 * the discount; an emptied cost goes back to the supplier list.
 *
 * @returns { rows, scanned, unchanged, sheets, unknownStores, problems:[{ sheet, row, reason }] }
 */
export function workbookToImport(read, { current = {}, stores = [] } = {}) {
  const byCode = new Map(stores.map((s) => [s.code, s]));
  const index = {};
  for (const sec of MATRIX_SECTIONS) {
    index[sec] = { byKey: new Map(), bySku: new Map() };
    for (const g of current[sec]?.groups || []) for (const r of g.rows || []) {
      index[sec].byKey.set(String(r.key), r);
      if (r.sku) index[sec].bySku.set(norm(r.sku), r);
    }
  }
  // `origins[i]` = where `rows[i]` came from (sheet, 1-based row), so a server
  // error about request row i can be shown as the Excel row the owner edits.
  const out = { rows: [], origins: [], scanned: 0, unchanged: 0, sheets: 0, unknownStores: [], unknownStoreSheets: [], problems: [] };
  const unknown = new Set();
  for (const sheet of read) {
    // Store codes present in the header that this account does not have.
    const map = mapColumns(sheet.rows, [...byCode.keys(), ...headerCodes(sheet.rows)]);
    if (!map) continue;
    out.sheets += 1;
    for (const s of map.stores) if (!byCode.has(s.code)) { unknown.add(s.code); out.unknownStoreSheets.push({ code: s.code, sheet: sheet.name }); }
    for (let i = map.dataRow; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] || [];
      const helper = map.base.key != null ? String(r[map.base.key] ?? "").trim() : "";
      let section = null;
      let key = null;
      if (helper.includes("|")) [section, key] = [helper.slice(0, helper.indexOf("|")), helper.slice(helper.indexOf("|") + 1)];
      const skuText = map.base.sku != null ? String(r[map.base.sku] ?? "").trim() : "";
      if (!section) {
        // A row the owner typed by hand: only frames/cases can be found by SKU.
        if (!skuText || (map.base.cost == null && !map.stores.some((s) => !blank(r[s.price]) || !blank(r[s.discount])))) continue;
        section = guessSection(sheet.name, index, skuText);
        if (!section) { out.problems.push({ sheet: sheet.name, row: i + 1, reason: "unknown_item" }); continue; }
      }
      if (!MATRIX_SECTIONS.includes(section)) continue;
      out.scanned += 1;
      const idx = index[section];
      const now = (key && idx.byKey.get(key)) || (skuText && idx.bySku.get(norm(skuText))) || null;
      const isFrame = section === "frames" || section === "cases";
      const ident = isFrame ? { sku: now?.sku || skuText } : { key: now?.key || key || skuText };
      const change = { section, ...ident };
      let touched = false;
      if (map.base.cost != null) {
        const raw = r[map.base.cost];
        const before = usd(now?.cost_cents);
        if (blank(raw)) { if (before != null && now?.cost_source !== "supplier_list") { change.cost = null; touched = true; } }
        else {
          const v = moneyIn(raw);
          if (v === undefined) out.problems.push({ sheet: sheet.name, row: i + 1, reason: "bad_value" });
          else if (before == null || Math.abs(v - before) >= 0.005) { change.cost = v; touched = true; }
        }
      }
      const perStore = {};
      for (const s of map.stores) {
        const store = byCode.get(s.code);
        if (!store) continue;
        const cell = now?.stores?.[store.id] || {};
        const exact = Boolean(cell.exact || cell.source === "store_exact");
        const entry = {};
        if (s.price != null) {
          const raw = r[s.price];
          const before = usd(cell.price_cents);
          if (blank(raw)) { if (exact) entry.price = null; }
          else {
            const v = moneyIn(raw);
            if (v === undefined) out.problems.push({ sheet: sheet.name, row: i + 1, reason: "bad_value" });
            else if (!now || before == null || Math.abs(v - before) >= 0.005) entry.price = v;
          }
        }
        if (s.discount != null) {
          const raw = r[s.discount];
          const before = Number(cell.discount_pct) || 0;
          if (blank(raw)) { if (before > 0) entry.discount = null; }
          else {
            const v = pctIn(raw);
            if (v === undefined) out.problems.push({ sheet: sheet.name, row: i + 1, reason: "bad_value" });
            else if (!now || Math.abs(v - before) >= 0.005) entry.discount = v;
          }
        }
        if (Object.keys(entry).length) perStore[s.code] = entry;
      }
      if (Object.keys(perStore).length) { change.stores = perStore; touched = true; }
      if (touched) { out.rows.push(change); out.origins.push({ sheet: sheet.name, row: i + 1 }); }
      else out.unchanged += 1;
    }
  }
  out.unknownStores = [...unknown];
  return out;
}

/** Store-looking codes in a header row ("Op7 · Nueva") so an unknown store is reported, not silently dropped. */
function headerCodes(rows) {
  const found = new Set();
  for (let i = 0; i < Math.min(rows.length, 6); i++) for (const v of rows[i] || []) {
    const s = String(v ?? "");
    if (s.includes("·")) { const c = s.split("·")[0].trim(); if (/^[A-Za-z]{1,4}\d{1,3}$/.test(c)) found.add(c); }
  }
  return [...found];
}

function guessSection(sheetName, index, sku) {
  const k = norm(sku);
  if (index.frames.bySku.has(k)) return "frames";
  if (index.cases.bySku.has(k)) return "cases";
  const n = norm(sheetName);
  if (/estuche|case/.test(n)) return "cases";
  if (/montura|frame/.test(n)) return "frames";
  return null;
}
