// El libro de Excel de «Reglas y comisiones»: se exporta TODO (costos de tienda
// con frecuencia, categoría fiscal y banderas; reglas de costo por venta;
// comisiones y la comisión por defecto) y el MISMO libro se vuelve a importar.
// Escrito con el escritor con estilos de exportXlsx.js (portada, cabecera en
// azul marino, $ y %, paneles inmovilizados); leído con su `readXlsx`.
//
// Cada hoja de datos lleva, debajo de la cabecera, una fila gris con la CLAVE
// de cada columna (amount, frequency…): es lo que lee la importación, así que
// el libro sirve igual exportado en español y reimportado con el panel en
// inglés, y una columna movida de sitio sigue leyéndose bien. Las columnas de
// solo lectura (Grupo, Mensual, Schedule C) no se importan. La columna oculta
// `id` une cada fila con la partida guardada; una fila sin id es una partida
// NUEVA. Nada se borra al importar: para retirar algo, «Activo = No».
import { T } from "../../i18n/translations.js";
import { buildStyledXlsx, readXlsx } from "../exportXlsx.js";
import { FREQUENCIES, groupOf, monthlyOf, SCHEDULE_C, TAX_CATEGORIES, taxOf } from "./model.js";

const NAVY = "#1F2A44";
const GOLD = "#C9A227";
const GRAY = "#6B7280";
const LIGHT = "#F3F4F6";

const head = (v) => ({ v, s: { bold: true, color: "#FFFFFF", fill: NAVY, border: true, align: "center", wrap: true } });
const key = (v) => ({ v, s: { italic: true, size: 8, color: GRAY, fill: LIGHT, border: true } });
const cell = (v, extra = {}) => ({ v: v ?? "", s: { border: true, ...extra } });
const money = (v) => cell(Number(v) || 0, { numFmt: "money" });
const yesNo = (b, t) => (b ? t("adm.fin.xl.yes") : t("adm.fin.xl.no"));

function sheetOf({ name, title, subtitle, cols, rows }) {
  const width = cols.length;
  const end = String.fromCharCode(64 + width);
  return {
    name,
    cols: cols.map((c) => ({ width: c.width || 14, hidden: c.hidden })),
    rows: [
      { height: 22, cells: [{ v: title, s: { bold: true, size: 14, color: NAVY } }] },
      { cells: [{ v: subtitle, s: { italic: true, color: GRAY } }] },
      { height: 30, cells: cols.map((c) => head(c.label)) },
      { cells: cols.map((c) => key(c.key)) },
      ...rows.map((r) => ({ cells: cols.map((c) => c.cell(r)) })),
    ],
    merges: [`A1:${end}1`, `A2:${end}2`],
    freeze: { row: 4, col: 0 },
    autoFilter: `A4:${end}${Math.max(4, rows.length + 4)}`,
  };
}

/**
 * Bytes del libro. `data` = GET /admin/finance/rules; `who` = quien exporta;
 * `business` = nombre de la óptica (tenant).
 */
export function buildRulesWorkbook({ data, t, lang, who = "", business = "" }) {
  const storeById = new Map(data.stores.map((s) => [s.id, s]));
  const code = (id) => (id ? storeById.get(id)?.code || id : t("adm.fin.shared"));
  const now = new Date();
  const stamp = now.toLocaleString(lang === "en" ? "en-US" : "es-US");
  const sales = data.sales_count || {};
  const chain = Object.values(sales).reduce((a, b) => a + b, 0);

  const items = [...data.items].sort((a, b) => groupOf(a).localeCompare(groupOf(b)) || String(code(a.establishment_id)).localeCompare(String(code(b.establishment_id))));
  const costCols = [
    { key: "id", label: "id", width: 6, hidden: true, cell: (r) => cell(r.id) },
    { key: "group", label: t("adm.fin.xl.group"), width: 16, cell: (r) => cell(t(`adm.fin.acc.${groupOf(r)}`), { color: GRAY }) },
    { key: "store", label: t("adm.fin.col.store"), width: 12, cell: (r) => cell(code(r.establishment_id)) },
    { key: "description", label: t("adm.fin.col.name"), width: 30, cell: (r) => cell(r.description || "") },
    { key: "tax_category", label: t("adm.fin.col.cat"), width: 24, cell: (r) => cell(t(`adm.fin.tax.${taxOf(r)}`)) },
    { key: "kind", label: t("adm.fin.f.kind"), width: 11, cell: (r) => cell(t(`adm.fin.kind.${r.kind}`)) },
    { key: "amount", label: t("adm.fin.col.amount"), width: 13, cell: (r) => money(r.amount) },
    { key: "frequency", label: t("adm.fin.col.freq"), width: 14, cell: (r) => cell(t(`adm.fin.freq.${r.frequency}`)) },
    { key: "per_sale", label: t("adm.fin.col.perSaleLong"), width: 14, cell: (r) => cell(yesNo(r.per_sale, t), { align: "center" }) },
    { key: "active", label: t("adm.fin.col.active"), width: 9, cell: (r) => cell(yesNo(r.active !== false, t), { align: "center" }) },
    { key: "monthly", label: t("adm.fin.col.monthly"), width: 13, cell: (r) => cell(monthlyOf(r, r.per_sale ? (r.establishment_id ? sales[r.establishment_id] ?? 0 : chain) : null), { numFmt: "money", color: GRAY }) },
    { key: "starts_on", label: t("adm.fin.f.starts"), width: 12, cell: (r) => cell(r.starts_on || "") },
    { key: "ends_on", label: t("adm.fin.f.ends"), width: 12, cell: (r) => cell(r.ends_on || "") },
    { key: "amortize_months", label: t("adm.fin.f.amortize"), width: 11, cell: (r) => cell(r.amortize_months ?? "") },
    { key: "allocation", label: t("adm.fin.f.alloc"), width: 14, cell: (r) => cell(r.establishment_id ? "" : t(r.allocation?.method === "percent" ? "adm.fin.f.byPercent" : "adm.fin.f.bySales")) },
    { key: "vendor", label: t("adm.fin.f.vendor"), width: 18, cell: (r) => cell(r.vendor || "") },
    { key: "notes", label: t("adm.fin.f.notes"), width: 30, cell: (r) => cell(r.notes || "", { wrap: true }) },
    { key: "schedule_c", label: t("adm.fin.xl.scheduleC"), width: 11, cell: (r) => cell(SCHEDULE_C[taxOf(r)] || "", { align: "center", color: GRAY }) },
  ];
  const ruleCols = [
    { key: "id", label: "id", width: 6, hidden: true, cell: (r) => cell(r.id) },
    { key: "kind", label: t("adm.fin.xl.ruleKind"), width: 24, cell: (r) => cell(t(`adm.fin.rk.${r.kind}`)) },
    { key: "match_key", label: t("adm.fin.xl.ruleKey"), width: 18, cell: (r) => cell(r.match_key) },
    { key: "label", label: t("adm.fin.col.name"), width: 34, cell: (r) => cell(r.label) },
    { key: "amount", label: t("adm.fin.col.amount"), width: 12, cell: (r) => cell(Number(r.amount) || 0) },
    { key: "unit", label: t("adm.fin.xl.unit"), width: 8, cell: (r) => cell(r.unit === "percent" ? "%" : "$", { align: "center", color: GRAY }) },
    { key: "active", label: t("adm.fin.col.active"), width: 9, cell: (r) => cell(yesNo(r.active, t), { align: "center" }) },
  ];
  const commRows = [
    { id: "default_commission_pct", code: "*", name: t("adm.fin.comm.default"), store: "", pct: data.commissions.default_pct ?? "", isDefault: true },
    ...data.commissions.sellers.map((s) => ({ id: s.id, code: s.code, name: s.name, store: s.establishment_id ? code(s.establishment_id) : "", pct: s.pct, active: s.active })),
  ];
  const commCols = [
    { key: "id", label: "id", width: 6, hidden: true, cell: (r) => cell(r.id) },
    { key: "code", label: t("adm.fin.xl.sellerCode"), width: 12, cell: (r) => cell(r.code, r.isDefault ? { bold: true } : {}) },
    { key: "name", label: t("adm.fin.xl.seller"), width: 28, cell: (r) => cell(r.name, r.isDefault ? { bold: true, fill: "#FFF7DB" } : {}) },
    { key: "store", label: t("adm.fin.col.store"), width: 10, cell: (r) => cell(r.store, { color: GRAY }) },
    { key: "pct", label: t("adm.fin.comm.pct"), width: 10, cell: (r) => cell(r.pct === "" ? "" : Number(r.pct), r.isDefault ? { bold: true, fill: "#FFF7DB" } : {}) },
    { key: "active", label: t("adm.fin.col.active"), width: 9, cell: (r) => cell(r.isDefault ? "" : yesNo(r.active, t), { align: "center", color: GRAY }) },
  ];

  const groups = ["fixed", "variable", "shared", "perSale", "taxes"];
  const totals = groups.map((g) => {
    const list = data.items.filter((i) => groupOf(i) === g && i.active !== false);
    return [t(`adm.fin.acc.${g}`), list.length, list.reduce((a, i) => a + (Number(i.monthly) || 0), 0)];
  });
  const cover = {
    name: t("adm.fin.xl.cover"),
    cols: [{ width: 34 }, { width: 16 }, { width: 18 }],
    gridlines: false,
    rows: [
      { height: 26, cells: [{ v: t("adm.fin.xl.title"), s: { bold: true, size: 16, color: NAVY } }] },
      { cells: [{ v: business, s: { bold: true, color: GOLD } }] },
      { cells: [{ v: t("adm.fin.xl.generated", { when: stamp, who: who || "—" }), s: { italic: true, color: GRAY } }] },
      { cells: [] },
      { cells: [head(t("adm.fin.xl.section")), head(t("adm.fin.xl.items")), head(t("adm.fin.acc.monthly"))] },
      ...totals.map(([label, n, m]) => ({ cells: [cell(label), cell(n, { align: "center" }), money(m)] })),
      { cells: [cell(t("adm.fin.xl.rules"), { bold: true }), cell(data.rules.length, { align: "center" }), cell("")] },
      { cells: [cell(t("adm.fin.comm.default"), { bold: true }), cell(data.commissions.default_pct == null ? "—" : `${data.commissions.default_pct} %`, { align: "center" }), cell("")] },
      { cells: [cell(t("adm.fin.taxRate"), { bold: true }), cell(`${data.taxes.rate_pct} %`, { align: "center" }), cell("")] },
      { cells: [] },
      { cells: [{ v: t("adm.fin.xl.howTitle"), s: { bold: true, color: NAVY } }] },
      ...["how1", "how2", "how3", "how4", "how5"].map((k) => ({ cells: [{ v: t(`adm.fin.xl.${k}`), s: { wrap: true } }] })),
      { cells: [] },
      { cells: [{ v: t("adm.fin.xl.listsTitle"), s: { bold: true, color: NAVY } }] },
      { cells: [cell(t("adm.fin.col.freq"), { bold: true }), cell(FREQUENCIES.map((f) => t(`adm.fin.freq.${f}`)).join(" · "), { wrap: true })] },
      { cells: [cell(t("adm.fin.col.cat"), { bold: true }), cell(TAX_CATEGORIES.map((c) => t(`adm.fin.tax.${c}`)).join(" · "), { wrap: true })] },
    ],
    merges: ["A1:C1", "A2:C2", "A3:C3", ...[0, 1, 2, 3, 4].map((i) => `A${16 + i}:C${16 + i}`)],
  };
  return buildStyledXlsx([
    cover,
    sheetOf({ name: t("adm.fin.xl.costs"), title: t("adm.fin.xl.costsTitle"), subtitle: t("adm.fin.xl.costsSub"), cols: costCols, rows: items }),
    sheetOf({ name: t("adm.fin.xl.rulesSheet"), title: t("adm.fin.rules.title"), subtitle: t("adm.fin.xl.rulesSub"), cols: ruleCols, rows: data.rules }),
    sheetOf({ name: t("adm.fin.xl.commissions"), title: t("adm.fin.acc.commissions"), subtitle: t("adm.fin.xl.commSub"), cols: commCols, rows: commRows }),
  ]);
}

/* ─────────────────────────── Lectura ─────────────────────────── */

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
/** Texto (en los dos idiomas) → código, para las listas cerradas. */
function reverse(prefix, codes) {
  const m = new Map();
  for (const c of codes) {
    m.set(fold(c), c);
    for (const lang of ["es", "en"]) {
      const label = T[lang]?.[`${prefix}${c}`];
      if (label) m.set(fold(label), c);
    }
  }
  return (v) => (v === null || v === undefined || String(v).trim() === "" ? undefined : m.get(fold(v)) ?? String(v).trim());
}
const FREQ = reverse("adm.fin.freq.", FREQUENCIES);
const TAX = reverse("adm.fin.tax.", TAX_CATEGORIES);
const KIND = reverse("adm.fin.kind.", ["fixed", "variable"]);
const RULE_KIND = reverse("adm.fin.rk.", ["order_fixed", "order_percent", "payment_fixed", "shipping"]);
const SHARED = new Set(["", "—", "-", ...["es", "en"].map((l) => fold(T[l]?.["adm.fin.shared"]))]);
const YES = new Set(["si", "sí", "yes", "y", "s", "x", "1", "true", "verdadero", ...["es", "en"].map((l) => fold(T[l]?.["adm.fin.xl.yes"]))]);
const NO = new Set(["no", "n", "0", "false", "falso", ...["es", "en"].map((l) => fold(T[l]?.["adm.fin.xl.no"]))]);
const flag = (v) => {
  if (v === true || v === false) return v;
  if (v === null || v === undefined || String(v).trim() === "") return undefined;
  const f = fold(v);
  if (YES.has(f)) return true;
  if (NO.has(f)) return false;
  return String(v);
};
const num = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : String(v);
};
/** Fecha: texto ISO o número de serie de Excel (si Excel la convirtió). */
const day = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return undefined;
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  return String(v).trim().slice(0, 10);
};
const text = (v) => (v === null || v === undefined ? undefined : String(v).trim());

/** La hoja que tiene en su fila de claves todas las `need`; null si no está. */
function findSheet(sheets, need) {
  for (const sh of sheets) {
    for (let r = 0; r < Math.min(sh.rows.length, 8); r++) {
      const keys = (sh.rows[r] || []).map((v) => String(v ?? "").trim());
      if (need.every((k) => keys.includes(k))) return { rows: sh.rows, keyRow: r, idx: Object.fromEntries(keys.map((k, i) => [k, i]).filter(([k]) => k)) };
    }
  }
  return null;
}
const rowsOf = (found) =>
  found ? found.rows.slice(found.keyRow + 1).map((cells, i) => ({ n: found.keyRow + 2 + i, get: (k) => (found.idx[k] === undefined ? undefined : cells?.[found.idx[k]]) })).filter((r) => (r.get("id") ?? "") !== "" || Object.keys(found.idx).some((k) => k !== "id" && r.get(k) !== null && r.get(k) !== undefined && String(r.get(k)).trim() !== "")) : [];

/**
 * El libro leído → lo que se manda a POST /admin/finance/rules/import, más lo
 * que el navegador ya sabe que no va (`missing`: hojas que no encontró).
 */
export async function parseRulesWorkbook(bytes) {
  const sheets = await readXlsx(bytes);
  const costs = findSheet(sheets, ["amount", "frequency", "tax_category"]);
  const rules = findSheet(sheets, ["match_key", "kind", "amount"]);
  const comm = findSheet(sheets, ["code", "pct"]);
  const out = { costs: [], rules: [], commissions: { sellers: [] }, missing: [] };
  if (!costs && !rules && !comm) out.missing.push("all");
  for (const r of rowsOf(costs)) {
    const store = text(r.get("store"));
    const alloc = text(r.get("allocation"));
    const allocFold = fold(alloc);
    const bySales = ["es", "en"].some((l) => fold(T[l]?.["adm.fin.f.bySales"]) === allocFold) || allocFold === "sales";
    out.costs.push({
      row: r.n,
      id: text(r.get("id")) || "",
      store: store === undefined || SHARED.has(fold(store)) ? "" : store,
      description: text(r.get("description")),
      tax_category: TAX(r.get("tax_category")),
      kind: KIND(r.get("kind")),
      amount: num(r.get("amount")),
      frequency: FREQ(r.get("frequency")),
      per_sale: flag(r.get("per_sale")),
      active: flag(r.get("active")),
      starts_on: day(r.get("starts_on")),
      ends_on: day(r.get("ends_on")) ?? null,
      amortize_months: num(r.get("amortize_months")) ?? null,
      vendor: text(r.get("vendor")) ?? null,
      notes: text(r.get("notes")) ?? null,
      ...(alloc && bySales ? { allocation: { method: "sales" } } : {}),
    });
  }
  for (const r of rowsOf(rules)) {
    out.rules.push({ row: r.n, id: text(r.get("id")) || "", kind: RULE_KIND(r.get("kind")), match_key: text(r.get("match_key")), label: text(r.get("label")), amount: num(r.get("amount")), active: flag(r.get("active")) !== false });
  }
  for (const r of rowsOf(comm)) {
    const id = text(r.get("id"));
    if (id === "default_commission_pct" || text(r.get("code")) === "*") out.commissions.default_pct = num(r.get("pct"));
    else out.commissions.sellers.push({ row: r.n, id: id || "", code: text(r.get("code")), pct: num(r.get("pct")) });
  }
  if (!costs) out.missing.push("costs");
  if (!rules) out.missing.push("rules");
  if (!comm) out.missing.push("commissions");
  return out;
}
