// Dónde se usa: «Productos y precios» → «Reglas y comisiones» → botón «Estado de
// resultados» (también ?tab=products&sub=rules-statement, el enlace del
// Ejecutivo → Resumen). El estado de resultados de un negocio pequeño de EE.
// UU., por tienda y consolidado, por mes / trimestre / año: ingresos netos por
// canal, costo de la mercancía (monturas, lentes, tratamientos, fijos por
// venta), utilidad bruta, gastos de operación por categoría fiscal (con la
// línea del Schedule C y del Form 1120-S), comisiones del cobro, comisiones de
// vendedores, utilidad de operación y neta; el impuesto de venta cobrado se
// muestra APARTE como pasivo (no es ingreso). Cada cifra cuadra al centavo con
// el resultado por tienda y con el Ejecutivo: salen del mismo libro
// (lib/financial-statement.ts → GET /admin/finance/statement).
//
// Exporta Excel (escritor con estilos de exportXlsx.js) y PDF (impresión
// aislada con membrete: negocio, período y la nota «Preparado para revisión
// del contador — no sustituye asesoría fiscal»).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { money } from "./adminOrders.js";
import { buildStyledXlsx, downloadBytes } from "./exportXlsx.js";
import { printHtml } from "./exportUtils.js";
import HelpTip from "./HelpTip.jsx";
import Icon from "./icons.jsx";
import { fetchStatement } from "./finance/financeApi.js";
import { store as ls } from "./finance/model.js";
import "./FinancialStatement.css";

const OPEX = ["rent", "utilities", "payroll", "payroll_taxes", "insurance", "advertising", "software", "professional_fees", "bank_fees", "repairs", "supplies", "taxes_licenses", "depreciation", "other"];
const pad = (n) => String(n).padStart(2, "0");
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const addMonths = (s, n) => { const [y, m] = s.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return ym(d); };

/** Rango de cada atajo, en meses YYYY-MM (los estados van por meses completos). */
export function presetRange(p, now = new Date()) {
  const cur = ym(now);
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3);
  switch (p) {
    case "month": return [cur, cur];
    case "lastMonth": return [addMonths(cur, -1), addMonths(cur, -1)];
    case "quarter": return [`${y}-${pad(q * 3 + 1)}`, cur];
    case "lastQuarter": { const s = addMonths(`${y}-${pad(q * 3 + 1)}`, -3); return [s, addMonths(s, 2)]; }
    case "last12": return [addMonths(cur, -11), cur];
    case "lastYear": return [`${y - 1}-01`, `${y - 1}-12`];
    default: return [`${y}-01`, cur];
  }
}
const PRESETS = ["ytd", "month", "lastMonth", "quarter", "lastQuarter", "last12", "lastYear", "custom"];

/**
 * Las líneas del estado, en orden. `get(s)` lee del estado en dólares; `tax` es
 * la clave de la línea fiscal (TAX_LINES del servidor); `level` 0 = sección,
 * 1 = subtotal, 2 = detalle; `minus` = se resta (se pinta entre paréntesis).
 */
function linesOf() {
  return [
    { id: "h.revenue", section: true },
    { id: "revenue.pos", get: (s) => s.revenue.pos, level: 2, tax: "revenue" },
    { id: "revenue.web", get: (s) => s.revenue.web, level: 2, tax: "revenue" },
    // La entrega cobrada al cliente de la tienda online: ingreso propio, junto a las ventas.
    { id: "revenue.shipping", get: (s) => s.revenue.shipping ?? 0, level: 2, tax: "shipping_income" },
    { id: "revenue.total", get: (s) => s.revenue.total, level: 1, tax: "revenue", help: "fin.st.revenue", strong: true },
    { id: "h.cogs", section: true },
    { id: "cogs.frames", get: (s) => s.cogs.frames, level: 2, minus: true, tax: "cogs" },
    { id: "cogs.lenses", get: (s) => s.cogs.lenses, level: 2, minus: true, tax: "cogs" },
    { id: "cogs.treatments", get: (s) => s.cogs.treatments, level: 2, minus: true, tax: "cogs" },
    { id: "cogs.per_order", get: (s) => s.cogs.per_order, level: 2, minus: true, tax: "cogs" },
    { id: "cogs.items", get: (s) => s.cogs.items, level: 2, minus: true, tax: "cost_of_goods" },
    { id: "cogs.total", get: (s) => s.cogs.total_all, level: 1, minus: true, tax: "cogs", help: "fin.st.cogs", strong: true },
    { id: "gross_profit", get: (s) => s.gross_profit, level: 1, tax: "gross_profit", help: "fin.st.grossProfit", strong: true, band: true },
    { id: "gross_margin", get: (s) => s.pct.gross_margin, level: 2, pct: true },
    { id: "h.opex", section: true },
    ...OPEX.map((c) => ({ id: `opex.${c}`, get: (s) => s.opex[c], level: 2, minus: true, tax: c, label: `adm.fin.tax.${c}` })),
    { id: "opex.card_fees", get: (s) => s.opex.card_fees, level: 2, minus: true, tax: "card_fees", help: "fin.st.cardFees" },
    { id: "opex.commissions", get: (s) => s.opex.commissions, level: 2, minus: true, tax: "commissions", help: "fin.st.commissions" },
    { id: "opex.total", get: (s) => s.opex.total, level: 1, minus: true, tax: "opex", help: "fin.st.opex", strong: true },
    { id: "operating_income", get: (s) => s.operating_income, level: 1, help: "fin.st.operating", strong: true, band: true },
    { id: "operating_margin", get: (s) => s.pct.operating_margin, level: 2, pct: true },
    { id: "net_income", get: (s) => s.net_income, level: 0, tax: "net_income", help: "fin.st.netIncome", strong: true, band: true, final: true },
    { id: "net_margin", get: (s) => s.pct.net_margin, level: 2, pct: true },
    { id: "h.memo", section: true },
    { id: "memo.sales_tax", get: (s) => s.sales_tax, level: 2, help: "fin.st.salesTax", tax: "sales_tax" },
    { id: "memo.gross_sales", get: (s) => s.gross_sales, level: 2, help: "fin.st.grossSales" },
    { id: "memo.sales_count", get: (s) => s.sales_count, level: 2, count: true },
    { id: "memo.gross_contribution", get: (s) => s.memo.gross_contribution, level: 2, help: "fin.st.grossContribution" },
    { id: "memo.contribution", get: (s) => s.memo.contribution, level: 2, help: "fin.contribution" },
    { id: "memo.contribution_margin", get: (s) => s.pct.contribution_margin, level: 2, pct: true, help: "fin.contributionMargin" },
    { id: "memo.fixed_total", get: (s) => s.memo.fixed_total, level: 2, help: "fin.fixedTotal" },
    { id: "memo.break_even", get: (s) => s.memo.break_even, level: 2, help: "fin.breakEven" },
  ];
}

const isZeroLine = (line, cols) => !line.section && !line.strong && !line.pct && !line.count && cols.every((s) => !Number(line.get(s) || 0));

export default function FinancialStatement({ initialStore = null, onClose }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const saved = ls.get("adm.fin.st", {});
  const [preset, setPreset] = useState(saved.preset || "ytd");
  const [range, setRange] = useState(() => (saved.preset === "custom" && saved.range ? saved.range : presetRange(saved.preset || "ytd")));
  const [group, setGroup] = useState(saved.group || "month");
  const [layout, setLayout] = useState(saved.layout || "periods");
  const [entity, setEntity] = useState(initialStore || "total");
  const [periodPick, setPeriodPick] = useState("all");
  const [showZero, setShowZero] = useState(false);
  const [showTax, setShowTax] = useState(saved.showTax !== false);
  const [doc, setDoc] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => { ls.set("adm.fin.st", { preset, range, group, layout, showTax }); }, [preset, range, group, layout, showTax]);

  const load = useCallback(() => {
    let off = false;
    setState("loading");
    fetchStatement({ from: `${range[0]}-01`, to: `${range[1]}-01`, store: "all", group })
      .then((d) => { if (!off) { setDoc(d); setState("ok"); } })
      .catch((e) => { if (!off) { setState(e.message || "adm.err.fin.load_failed"); } });
    return () => { off = true; };
  }, [range, group]);
  useEffect(load, [load]);

  const m = (v) => (v === null || v === undefined ? "—" : money(Number(v), "usd", lang));
  const lines = useMemo(linesOf, []);
  const entities = doc?.entities || [];
  const ent = entities.find((e) => e.id === entity) || entities.find((e) => e.id === "total");
  const entName = (e) => (e?.kind === "total" ? t("adm.fin.st.consolidated") : e?.kind === "web" ? t("adm.fin.st.web") : `${e?.code} · ${e?.name}`);
  const periodLabel = (p) => {
    if (p === "all") return t("adm.fin.st.total");
    if (/^\d{4}-Q\d$/.test(p)) return t("adm.fin.st.quarterN", { q: p.slice(-1), y: p.slice(0, 4) });
    if (/^\d{4}$/.test(p)) return p;
    const [y, mo] = p.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(lang === "en" ? "en-US" : "es-US", { month: "short", year: "numeric" });
  };
  const columns = useMemo(() => {
    if (!doc || !ent) return [];
    if (layout === "entities") {
      const p = doc.statements[periodPick] ? periodPick : "all";
      return entities.map((e) => ({ key: e.id, label: e.kind === "store" ? e.code : e.kind === "total" ? t("adm.fin.st.consolidatedShort") : entName(e), title: entName(e), color: e.color, s: doc.statements[p][e.id], total: e.kind === "total" }));
    }
    const ps = doc.periods.length > 1 ? [...doc.periods, "all"] : doc.periods;
    return ps.map((p) => ({ key: p, label: periodLabel(p), title: periodLabel(p), s: doc.statements[p][ent.id], total: p === "all" }));
  }, [doc, ent, layout, periodPick, entities, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = lines.filter((l) => showZero || !isZeroLine(l, columns.map((c) => c.s)));
  const label = (l) => t(l.label || `adm.fin.st.l.${l.id}`);
  const fmtCell = (l, s) => {
    const v = l.get(s);
    if (l.pct) return v === null || v === undefined ? "—" : `${v} %`;
    if (l.count) return String(v ?? 0);
    if (v === null || v === undefined) return "—";
    return l.minus && Number(v) ? `(${m(Math.abs(Number(v)))})` : m(v);
  };
  const periodText = doc ? t("adm.fin.st.periodText", { from: periodLabel(doc.months[0]), to: periodLabel(doc.months[doc.months.length - 1]) }) : "";
  const subject = layout === "entities" ? t("adm.fin.st.byStore") : entName(ent);
  const taxLine = (l) => (l.tax && doc?.tax_lines?.[l.tax]) || null;

  // ── Excel ──
  const exportXlsx = () => {
    if (!doc) return;
    const NAVY = "#1F2A44";
    const n = columns.length;
    const lastCol = 1 + n + (showTax ? 2 : 0);
    const L = (i) => String.fromCharCode(65 + i);
    const top = (v, s = {}) => ({ cells: [{ v, s }] });
    const headerCells = [{ v: t("adm.fin.st.concept"), s: { bold: true, color: "#FFFFFF", fill: NAVY, border: true } }, ...columns.map((c) => ({ v: c.title, s: { bold: true, color: "#FFFFFF", fill: c.color && layout === "entities" ? c.color : NAVY, border: true, align: "center", wrap: true } })),
      ...(showTax ? [{ v: "Schedule C", s: { bold: true, color: "#FFFFFF", fill: NAVY, border: true, align: "center" } }, { v: "Form 1120-S", s: { bold: true, color: "#FFFFFF", fill: NAVY, border: true, align: "center" } }] : [])];
    const body = shown.map((l) => {
      if (l.section) return { cells: [{ v: label(l).toUpperCase(), s: { bold: true, color: NAVY, fill: "#E8ECF4", border: true } }, ...columns.map(() => ({ v: "", s: { fill: "#E8ECF4", border: true } })), ...(showTax ? [{ v: "", s: { fill: "#E8ECF4", border: true } }, { v: "", s: { fill: "#E8ECF4", border: true } }] : [])] };
      const style = { border: true, bold: Boolean(l.strong), fill: l.final ? "#FFF7DB" : l.band ? "#F3F4F6" : undefined };
      const tl = taxLine(l);
      return {
        cells: [
          { v: `${"  ".repeat(l.level === 2 ? 1 : 0)}${label(l)}`, s: style },
          ...columns.map((c) => {
            const v = l.get(c.s);
            if (l.pct) return { v: v == null ? "" : Number(v) / 100, s: { ...style, numFmt: "pct" } };
            if (l.count) return { v: Number(v) || 0, s: { ...style, numFmt: "int" } };
            return { v: v == null ? "" : (l.minus ? -1 : 1) * Number(v), s: { ...style, numFmt: "money" } };
          }),
          ...(showTax ? [{ v: tl?.schedule_c || "", s: { ...style, align: "center" } }, { v: tl?.f1120s || "", s: { ...style, align: "center" } }] : []),
        ],
      };
    });
    const rows = [
      top(doc.business.legal_name || doc.business.name, { bold: true, size: 15, color: NAVY }),
      top(t("adm.fin.st.title"), { bold: true, size: 13 }),
      top(`${subject} · ${periodText}`, { italic: true }),
      top(t("adm.fin.st.basis", { currency: doc.business.currency }), { italic: true, color: "#6B7280" }),
      top(t("adm.fin.st.preparer"), { italic: true, color: "#9A3412" }),
      { cells: [] },
      { height: 30, cells: headerCells },
      ...body,
      { cells: [] },
      top(t("adm.fin.st.footer", { when: new Date(doc.generated_at).toLocaleString(lang === "en" ? "en-US" : "es-US") }), { italic: true, color: "#6B7280", size: 9 }),
      ...["n1", "n2", "n3", "n4"].map((k) => top(t(`adm.fin.st.note.${k}`), { color: "#6B7280", size: 9, wrap: true })),
    ];
    const merges = [0, 1, 2, 3, 4].map((i) => `A${i + 1}:${L(lastCol - 1)}${i + 1}`);
    const notesStart = 7 + body.length + 2;
    for (let i = 0; i < 5; i++) merges.push(`A${notesStart + i}:${L(lastCol - 1)}${notesStart + i}`);
    try {
      const bytes = buildStyledXlsx([{ name: t("adm.fin.st.sheet"), cols: [{ width: 44 }, ...columns.map(() => ({ width: 15 })), ...(showTax ? [{ width: 14 }, { width: 14 }] : [])], rows, merges, freeze: { row: 7, col: 1 }, gridlines: false }]);
      downloadBytes(`estado-de-resultados-${range[0]}-${range[1]}.xlsx`, bytes);
    } catch {
      toast({ tone: "error", title: t("adm.err.fin.export_failed") });
    }
  };

  // ── PDF (impresión aislada con membrete) ──
  const exportPdf = () => {
    if (!doc) return;
    const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    const head = `<tr><th class="c">${esc(t("adm.fin.st.concept"))}</th>${columns.map((c) => `<th>${esc(c.title)}</th>`).join("")}${showTax ? "<th>Sch. C</th><th>1120-S</th>" : ""}</tr>`;
    const body = shown.map((l) => {
      if (l.section) return `<tr class="sec"><td colspan="${columns.length + 1 + (showTax ? 2 : 0)}">${esc(label(l))}</td></tr>`;
      const tl = taxLine(l);
      return `<tr class="${l.strong ? "b" : ""} ${l.band ? "band" : ""} ${l.final ? "fin" : ""} lv${l.level}"><td class="c">${esc(label(l))}</td>${columns.map((c) => `<td>${esc(fmtCell(l, c.s))}</td>`).join("")}${showTax ? `<td class="tl">${esc(tl?.schedule_c || "")}</td><td class="tl">${esc(tl?.f1120s || "")}</td>` : ""}</tr>`;
    }).join("");
    const html = `<header class="lh"><div><h1>${esc(doc.business.legal_name || doc.business.name)}</h1><h2>${esc(t("adm.fin.st.title"))}</h2><p>${esc(subject)} · ${esc(periodText)}</p><p class="basis">${esc(t("adm.fin.st.basis", { currency: doc.business.currency }))}</p></div><div class="prep">${esc(t("adm.fin.st.preparer"))}</div></header>
<table><thead>${head}</thead><tbody>${body}</tbody></table>
<footer><p>${esc(t("adm.fin.st.footer", { when: new Date(doc.generated_at).toLocaleString(lang === "en" ? "en-US" : "es-US") }))}</p>${["n1", "n2", "n3", "n4"].map((k) => `<p>${esc(t(`adm.fin.st.note.${k}`))}</p>`).join("")}<div class="sign"><span>${esc(t("adm.fin.st.signOwner"))}</span><span>${esc(t("adm.fin.st.signCpa"))}</span></div></footer>`;
    const css = `@page{size:letter ${columns.length > 6 ? "landscape" : "portrait"};margin:14mm}body{font:10.5px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827}
.lh{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #1F2A44;padding-bottom:8px;margin-bottom:10px}.lh h1{margin:0;font-size:18px;color:#1F2A44}.lh h2{margin:2px 0;font-size:14px}.lh p{margin:0;color:#374151}.lh .basis{color:#6B7280;font-style:italic}
.prep{max-width:220px;border:1px solid #F59E0B;background:#FFFBEB;color:#9A3412;padding:6px 8px;border-radius:4px;font-weight:600;font-size:9.5px;align-self:flex-start}
table{width:100%;border-collapse:collapse}th{background:#1F2A44;color:#fff;padding:5px 6px;text-align:right;font-size:9.5px}th.c{text-align:left}td{padding:3px 6px;text-align:right;border-bottom:1px solid #E5E7EB;font-variant-numeric:tabular-nums;white-space:nowrap}td.c{text-align:left;white-space:normal}
tr.sec td{background:#E8ECF4;color:#1F2A44;font-weight:800;text-transform:uppercase;letter-spacing:.04em;text-align:left;padding-top:6px}tr.b td{font-weight:700}tr.band td{background:#F3F4F6}tr.fin td{background:#FFF7DB;border-top:2px solid #1F2A44;border-bottom:3px double #1F2A44}tr.lv2 td.c{padding-left:16px}td.tl{color:#6B7280;text-align:center;font-size:9px}
footer{margin-top:12px;color:#6B7280;font-size:9px}footer p{margin:2px 0}.sign{display:flex;gap:40px;margin-top:28px}.sign span{flex:1;border-top:1px solid #9CA3AF;padding-top:4px}`;
    printHtml({ html, css, title: `${t("adm.fin.st.title")} · ${periodText}`, lang });
  };

  const changePreset = (p) => { setPreset(p); if (p !== "custom") setRange(presetRange(p)); };

  return (
    <div className="fst adm-section">
      <div className="fst-head">
        <button type="button" className="btn-xs" onClick={onClose}><Icon name="chevronLeft" size={13} /> {t("adm.fin.st.back")}</button>
        <h2><Icon name="receipt" size={18} /> {t("adm.fin.st.title")}<HelpTip topic="fin.st.what" /></h2>
        <span className="fst-act">
          <button type="button" className="btn-xs" onClick={exportXlsx} disabled={!doc}><Icon name="excel" size={13} /> Excel</button>
          <button type="button" className="btn-xs" onClick={exportPdf} disabled={!doc}><Icon name="printer" size={13} /> PDF</button>
        </span>
      </div>
      <p className="fst-prep"><Icon name="alert" size={12} /> {t("adm.fin.st.preparer")}</p>
      <div className="fst-bar" role="group" aria-label={t("adm.fin.st.controls")}>
        <label>{t("adm.fin.st.period")}
          <select value={preset} onChange={(e) => changePreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p} value={p}>{t(`adm.fin.st.preset.${p}`)}</option>)}
          </select>
        </label>
        {preset === "custom" && (
          <>
            <label>{t("adm.fin.st.from")}<input type="month" value={range[0]} max={range[1]} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} /></label>
            <label>{t("adm.fin.st.to")}<input type="month" value={range[1]} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], e.target.value])} /></label>
          </>
        )}
        <span className="pp-seg" role="tablist" aria-label={t("adm.fin.st.group")}>
          {["month", "quarter", "year"].map((g) => <button key={g} type="button" role="tab" aria-selected={group === g} className={group === g ? "on" : ""} onClick={() => setGroup(g)}>{t(`adm.fin.st.g.${g}`)}</button>)}
        </span>
        <span className="pp-seg" role="tablist" aria-label={t("adm.fin.st.layout")}>
          {["periods", "entities"].map((l) => <button key={l} type="button" role="tab" aria-selected={layout === l} className={layout === l ? "on" : ""} onClick={() => setLayout(l)}>{t(`adm.fin.st.lay.${l}`)}</button>)}
        </span>
        {layout === "periods" ? (
          <label>{t("adm.fin.st.entity")}
            <select value={ent?.id || "total"} onChange={(e) => setEntity(e.target.value)}>
              {entities.map((e) => <option key={e.id} value={e.id}>{entName(e)}</option>)}
            </select>
          </label>
        ) : (
          <label>{t("adm.fin.st.period")}
            <select value={periodPick} onChange={(e) => setPeriodPick(e.target.value)}>
              <option value="all">{t("adm.fin.st.total")}</option>
              {(doc?.periods || []).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
          </label>
        )}
        <label className="fst-check"><input type="checkbox" checked={showTax} onChange={(e) => setShowTax(e.target.checked)} /> {t("adm.fin.st.taxLines")}<HelpTip topic="fin.st.taxLines" /></label>
        <label className="fst-check"><input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> {t("adm.fin.st.zero")}</label>
      </div>
      {state === "loading" && !doc && <div className="adm-src-note loading">{t("adm.fin.loading")}</div>}
      {state !== "ok" && state !== "loading" && (
        <div className="adm-login-err">{t(state)} <button type="button" className="btn-xs" onClick={load}>{t("adm.fin.retry")}</button></div>
      )}
      {doc && ent && (
        <div className={`fst-wrap ${state === "loading" ? "is-loading" : ""}`}>
          <p className="fst-sub"><b>{doc.business.legal_name || doc.business.name}</b> · {subject} · {periodText}</p>
          <div className="fst-scroll">
            <table className="fst-table">
              <thead>
                <tr>
                  <th scope="col" className="c">{t("adm.fin.st.concept")}</th>
                  {columns.map((c) => <th key={c.key} scope="col" title={c.title} className={c.total ? "tot" : ""} style={c.color ? { boxShadow: `inset 0 3px 0 ${c.color}` } : undefined}>{c.label}</th>)}
                  {showTax && <th scope="col" className="tl" title="Schedule C (Form 1040)">Sch. C</th>}
                  {showTax && <th scope="col" className="tl" title="Form 1120-S">1120-S</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  if (l.section) return <tr key={l.id} className="sec"><th colSpan={columns.length + 1 + (showTax ? 2 : 0)} scope="rowgroup">{label(l)}</th></tr>;
                  const tl = taxLine(l);
                  return (
                    <tr key={l.id} className={`${l.strong ? "b" : ""} ${l.band ? "band" : ""} ${l.final ? "fin" : ""} lv${l.level}`}>
                      <th scope="row" className="c">{label(l)}{l.help && <HelpTip topic={l.help} />}</th>
                      {columns.map((c) => {
                        const v = l.get(c.s);
                        const neg = !l.pct && !l.count && !l.minus && Number(v) < 0;
                        return <td key={c.key} data-label={c.label} className={`${c.total ? "tot" : ""} ${neg ? "neg" : ""}`}>{fmtCell(l, c.s)}</td>;
                      })}
                      {showTax && <td className="tl">{tl?.schedule_c || ""}</td>}
                      {showTax && <td className="tl">{tl?.f1120s || ""}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="fst-notes">
            {["n1", "n2", "n3", "n4"].map((k) => <li key={k}>{t(`adm.fin.st.note.${k}`)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
