// Dónde se usa: «Productos y precios» → «Reglas y comisiones» → botón «Informe
// fiscal». Un diálogo corto: se elige el período (atajos o de mes a mes) y sale
// el INFORME FISCAL en PDF (impresión aislada con membrete), para el contador y
// para la declaración del impuesto de venta:
//
//   1. Resumen del período: ventas cobradas, impuesto de venta cobrado (pasivo,
//      no es ingreso), ventas netas, gravadas y exentas, costo de la mercancía,
//      utilidad bruta, gastos deducibles y utilidad neta.
//   2. Impuesto de venta mes a mes (lo que pide la declaración).
//   3. Ingresos y gastos por línea del Schedule C y del Form 1120-S.
//   4. Por tienda.
//
// Las cifras salen del mismo libro que el estado de resultados y el resultado
// por tienda (GET /admin/finance/statement, lib/financial-statement.ts): no hay
// un segundo cálculo aquí, solo otra forma de presentarlo.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { money } from "./adminOrders.js";
import { printHtml } from "./exportUtils.js";
import Icon from "./icons.jsx";
import { fetchStatement } from "./finance/financeApi.js";
import { store as ls } from "./finance/model.js";
import Modal from "./pricing/matrix/Modal.jsx";
import { presetRange } from "./FinancialStatement.jsx";

const PRESETS = ["lastMonth", "month", "lastQuarter", "quarter", "ytd", "lastYear", "custom"];
/** Gastos de operación, en el orden del Schedule C; `card_fees` y `commissions` van aparte en el estado. */
const OPEX = ["advertising", "commissions", "card_fees", "bank_fees", "depreciation", "insurance", "professional_fees", "software", "rent", "repairs", "supplies", "taxes_licenses", "utilities", "payroll", "payroll_taxes", "other"];
const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

/**
 * El HTML del informe. Puro: `doc` = GET /admin/finance/statement (group "month"),
 * `entity` = id de la entidad a informar ("total" = consolidado). Exportado para probarlo.
 */
export function fiscalReportHtml(doc, { t, lang, entity = "total" }) {
  const m = (v) => money(Number(v) || 0, "usd", lang);
  const neg = (v) => (Number(v) ? `(${m(Math.abs(Number(v)))})` : m(0));
  const ent = doc.entities.find((e) => e.id === entity) || doc.entities.find((e) => e.id === "total");
  const all = doc.statements.all[ent.id];
  const name = (e) => (e.kind === "total" ? t("adm.fin.st.consolidated") : e.kind === "web" ? t("adm.fin.st.web") : `${e.code} · ${e.name}`);
  const monthLabel = (p) => { const [y, mo] = p.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString(lang === "en" ? "en-US" : "es-US", { month: "long", year: "numeric" }); };
  const tl = (k) => doc.tax_lines?.[k] || {};
  const period = t("adm.fin.st.periodText", { from: monthLabel(doc.months[0]), to: monthLabel(doc.months[doc.months.length - 1]) });
  // «Ventas netas» = lo vendido (sin impuesto). La entrega cobrada al cliente de
  // la tienda online es ingreso aparte: gravadas + exentas = ventas netas, siempre.
  const goods = (s) => Number(s.revenue.pos) + Number(s.revenue.web);
  const ship = (s) => Number(s.revenue.shipping) || 0;
  const row = (label, value, cls = "") => `<tr class="${cls}"><td class="c">${esc(label)}</td><td>${esc(value)}</td></tr>`;

  const summary = [
    row(t("adm.fin.fx.gross"), m(all.gross_sales)),
    row(t("adm.fin.fx.salesTax"), neg(all.sales_tax)),
    row(t("adm.fin.fx.net"), m(goods(all)), "b"),
    row(t("adm.fin.fx.taxable"), m(all.taxable_sales), "lv2"),
    row(t("adm.fin.fx.exempt"), m(all.exempt_sales), "lv2"),
    ...(ship(all) ? [row(t("adm.fin.fx.shipping"), m(ship(all))), row(t("adm.fin.fx.income"), m(all.revenue.total), "b")] : []),
    row(t("adm.fin.fx.cogs"), neg(all.cogs.total_all)),
    row(t("adm.fin.fx.grossProfit"), m(all.gross_profit), "b"),
    row(t("adm.fin.fx.expenses"), neg(all.opex.total)),
    row(t("adm.fin.fx.netIncome"), all.net_income < 0 ? neg(all.net_income) : m(all.net_income), "fin"),
  ].join("");

  const months = doc.periods.map((p) => {
    const s = doc.statements[p][ent.id];
    return `<tr><td class="c">${esc(monthLabel(p))}</td><td>${s.sales_count}</td><td>${esc(m(goods(s)))}</td><td>${esc(m(s.taxable_sales))}</td><td>${esc(m(s.exempt_sales))}</td><td>${esc(m(s.sales_tax))}</td></tr>`;
  }).join("");
  const monthsTotal = `<tr class="fin"><td class="c">${esc(t("adm.fin.st.total"))}</td><td>${all.sales_count}</td><td>${esc(m(goods(all)))}</td><td>${esc(m(all.taxable_sales))}</td><td>${esc(m(all.exempt_sales))}</td><td>${esc(m(all.sales_tax))}</td></tr>`;

  const line = (label, value, key, cls = "") => `<tr class="${cls}"><td class="c">${esc(label)}</td><td>${esc(value)}</td><td class="tl">${esc(tl(key).schedule_c || "")}</td><td class="tl">${esc(tl(key).f1120s || "")}</td></tr>`;
  const expenses = OPEX.filter((k) => Number(all.opex[k])).map((k) => line(t(k === "card_fees" ? "adm.fin.st.l.opex.card_fees" : k === "commissions" ? "adm.fin.st.l.opex.commissions" : `adm.fin.tax.${k}`), m(all.opex[k]), k, "lv2")).join("");
  const schedule = [
    ...(ship(all)
      ? [line(t("adm.fin.fx.net"), m(goods(all)), "revenue", "lv2"), line(t("adm.fin.fx.shipping"), m(ship(all)), "shipping_income", "lv2"), line(t("adm.fin.fx.income"), m(all.revenue.total), "revenue", "b")]
      : [line(t("adm.fin.fx.net"), m(all.revenue.total), "revenue", "b")]),
    line(t("adm.fin.fx.cogs"), neg(all.cogs.total_all), "cogs"),
    line(t("adm.fin.fx.grossProfit"), m(all.gross_profit), "gross_profit", "b"),
    `<tr class="sec"><td colspan="4">${esc(t("adm.fin.fx.expensesTitle"))}</td></tr>`,
    expenses || `<tr><td class="c" colspan="4">${esc(t("adm.fin.fx.noExpenses"))}</td></tr>`,
    line(t("adm.fin.fx.expenses"), neg(all.opex.total), "", "b"),
    line(t("adm.fin.fx.netIncome"), all.net_income < 0 ? neg(all.net_income) : m(all.net_income), "net_income", "fin"),
  ].join("");

  const stores = doc.entities.filter((e) => e.kind !== "total");
  const byStore = ent.kind === "total" && stores.length > 1
    ? `<h3>${esc(t("adm.fin.fx.byStore"))}</h3><table><thead><tr><th class="c">${esc(t("adm.fin.fx.store"))}</th><th>${esc(t("adm.fin.fx.sales"))}</th><th>${esc(t("adm.fin.fx.net"))}</th><th>${esc(t("adm.fin.fx.taxable"))}</th><th>${esc(t("adm.fin.fx.salesTaxShort"))}</th><th>${esc(t("adm.fin.fx.netIncome"))}</th></tr></thead><tbody>${stores.map((e) => { const s = doc.statements.all[e.id]; return `<tr><td class="c">${esc(name(e))}</td><td>${s.sales_count}</td><td>${esc(m(goods(s)))}</td><td>${esc(m(s.taxable_sales))}</td><td>${esc(m(s.sales_tax))}</td><td>${esc(s.net_income < 0 ? neg(s.net_income) : m(s.net_income))}</td></tr>`; }).join("")}</tbody></table>`
    : "";

  const html = `<header class="lh"><div><h1>${esc(doc.business.legal_name || doc.business.name)}</h1><h2>${esc(t("adm.fin.fx.title"))}</h2><p>${esc(name(ent))} · ${esc(period)}</p><p class="basis">${esc(t("adm.fin.st.basis", { currency: doc.business.currency }))}</p></div><div class="prep">${esc(t("adm.fin.st.preparer"))}</div></header>
<h3>${esc(t("adm.fin.fx.summary"))}</h3><table class="narrow"><tbody>${summary}</tbody></table>
<h3>${esc(t("adm.fin.fx.salesTaxTitle"))}</h3><table><thead><tr><th class="c">${esc(t("adm.fin.fx.month"))}</th><th>${esc(t("adm.fin.fx.sales"))}</th><th>${esc(t("adm.fin.fx.net"))}</th><th>${esc(t("adm.fin.fx.taxable"))}</th><th>${esc(t("adm.fin.fx.exempt"))}</th><th>${esc(t("adm.fin.fx.salesTaxShort"))}</th></tr></thead><tbody>${months}${doc.periods.length > 1 ? monthsTotal : ""}</tbody></table>
<p class="note">${esc(t("adm.fin.fx.salesTaxNote"))}</p>
<h3>${esc(t("adm.fin.fx.scheduleTitle"))}</h3><table><thead><tr><th class="c">${esc(t("adm.fin.st.concept"))}</th><th>${esc(t("adm.fin.fx.amount"))}</th><th>Sch. C</th><th>1120-S</th></tr></thead><tbody>${schedule}</tbody></table>
${byStore}
<footer><p>${esc(t("adm.fin.st.footer", { when: new Date(doc.generated_at).toLocaleString(lang === "en" ? "en-US" : "es-US") }))}</p><p>${esc(t("adm.fin.fx.note1"))}</p><p>${esc(t("adm.fin.fx.note2"))}</p><div class="sign"><span>${esc(t("adm.fin.st.signOwner"))}</span><span>${esc(t("adm.fin.st.signCpa"))}</span></div></footer>`;
  const css = `@page{size:letter portrait;margin:14mm}body{font:10.5px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827}
.lh{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #1F2A44;padding-bottom:8px;margin-bottom:6px}.lh h1{margin:0;font-size:18px;color:#1F2A44}.lh h2{margin:2px 0;font-size:14px}.lh p{margin:0;color:#374151}.lh .basis{color:#6B7280;font-style:italic}
.prep{max-width:220px;border:1px solid #F59E0B;background:#FFFBEB;color:#9A3412;padding:6px 8px;border-radius:4px;font-weight:600;font-size:9.5px;align-self:flex-start}
h3{margin:14px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#1F2A44}
table{width:100%;border-collapse:collapse;page-break-inside:auto}table.narrow{width:62%}tr{page-break-inside:avoid}th{background:#1F2A44;color:#fff;padding:5px 6px;text-align:right;font-size:9.5px}th.c{text-align:left}td{padding:3px 6px;text-align:right;border-bottom:1px solid #E5E7EB;font-variant-numeric:tabular-nums;white-space:nowrap}td.c{text-align:left;white-space:normal}
tr.sec td{background:#E8ECF4;color:#1F2A44;font-weight:800;text-transform:uppercase;letter-spacing:.04em;text-align:left}tr.b td{font-weight:700;background:#F3F4F6}tr.fin td{font-weight:800;background:#FFF7DB;border-top:2px solid #1F2A44;border-bottom:3px double #1F2A44}tr.lv2 td.c{padding-left:18px}td.tl{color:#6B7280;font-size:9px;width:92px}
.note{margin:4px 0 0;color:#6B7280;font-size:9px}footer{margin-top:14px;color:#6B7280;font-size:9px}footer p{margin:2px 0}.sign{display:flex;gap:40px;margin-top:30px}.sign span{flex:1;border-top:1px solid #9CA3AF;padding-top:4px}`;
  return { html, css, title: `${t("adm.fin.fx.title")} · ${period}` };
}

/**
 * @param scope   "all" o el id de la tienda elegida en la barra
 * @param stores  tiendas (para decir cuál es) — [{ id, code, name }]
 */
export default function FiscalReport({ scope = "all", stores = [], onClose }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const saved = ls.get("adm.fin.fx", {});
  const [preset, setPreset] = useState(PRESETS.includes(saved.preset) ? saved.preset : "lastMonth");
  const [range, setRange] = useState(() => (saved.preset === "custom" && saved.range ? saved.range : presetRange(PRESETS.includes(saved.preset) ? saved.preset : "lastMonth")));
  const [who, setWho] = useState(scope === "all" ? "total" : scope);
  const [doc, setDoc] = useState(null);
  const [state, setState] = useState("loading");
  useEffect(() => { ls.set("adm.fin.fx", { preset, range }); }, [preset, range]);

  const bad = range[0] > range[1];
  useEffect(() => {
    if (bad) return undefined;
    let off = false;
    setState("loading");
    fetchStatement({ from: `${range[0]}-01`, to: `${range[1]}-01`, store: "all", group: "month" })
      .then((d) => { if (!off) { setDoc(d); setState("ok"); } })
      .catch((e) => { if (!off) { setDoc(null); setState(e.message || "adm.err.fin.load_failed"); } });
    return () => { off = true; };
  }, [range, bad]);

  const m = (v) => money(Number(v) || 0, "usd", lang);
  const entities = useMemo(() => doc?.entities || [], [doc]);
  const ent = entities.find((e) => e.id === who) || entities.find((e) => e.id === "total");
  const s = doc && ent ? doc.statements.all[ent.id] : null;
  const entName = (e) => (e.kind === "total" ? t("adm.fin.st.consolidated") : e.kind === "web" ? t("adm.fin.st.web") : `${e.code} · ${e.name}`);
  const pick = (p) => { setPreset(p); if (p !== "custom") setRange(presetRange(p)); };
  const print = () => {
    if (!doc || !ent) return;
    try {
      printHtml({ ...fiscalReportHtml(doc, { t, lang, entity: ent.id }), lang });
    } catch {
      toast({ tone: "error", title: t("adm.err.fin.export_failed") });
    }
  };

  return (
    <Modal
      title={t("adm.fin.fx.title")}
      sub={t("adm.fin.fx.sub")}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.fin.cancel")}</button>
          <button type="button" className="btn-sm primary" onClick={print} disabled={!s || bad || state !== "ok"}><Icon name="printer" size={14} /> {t("adm.fin.fx.generate")}</button>
        </>
      )}
    >
      <div className="fx">
        <div className="fx-presets" role="group" aria-label={t("adm.fin.fx.period")}>
          {PRESETS.map((p) => (
            <button key={p} type="button" className={`btn-xs ${preset === p ? "primary on" : ""}`} aria-pressed={preset === p} onClick={() => pick(p)}>{t(`adm.fin.st.preset.${p}`)}</button>
          ))}
        </div>
        <div className="fx-range">
          <label>{t("adm.fin.fx.from")}<input type="month" className="pp-input" value={range[0]} max={range[1]} onChange={(e) => { if (e.target.value) { setPreset("custom"); setRange([e.target.value, range[1]]); } }} /></label>
          <label>{t("adm.fin.fx.to")}<input type="month" className="pp-input" value={range[1]} min={range[0]} onChange={(e) => { if (e.target.value) { setPreset("custom"); setRange([range[0], e.target.value]); } }} /></label>
          <label>{t("adm.fin.fx.entity")}
            <select className="pp-input" value={ent?.id || "total"} onChange={(e) => setWho(e.target.value)}>
              {(entities.length ? entities.slice().sort((a, b) => (b.kind === "total") - (a.kind === "total")) : [{ id: "total", kind: "total" }, ...stores.map((x) => ({ ...x, kind: "store" }))]).map((e) => <option key={e.id} value={e.id}>{entName(e)}</option>)}
            </select>
          </label>
        </div>
        {bad && <p className="fx-msg bad">{t("adm.fin.fx.badRange")}</p>}
        {!bad && state === "loading" && <p className="fx-msg">{t("adm.ord.loading")}</p>}
        {!bad && state !== "loading" && state !== "ok" && <p className="fx-msg bad">{t(state)}</p>}
        {!bad && state === "ok" && s && (
          <dl className="fx-preview">
            <div><dt>{t("adm.fin.fx.net")}</dt><dd>{m(Number(s.revenue.pos) + Number(s.revenue.web))}</dd></div>
            <div><dt>{t("adm.fin.fx.taxable")}</dt><dd>{m(s.taxable_sales)}</dd></div>
            <div><dt>{t("adm.fin.fx.exempt")}</dt><dd>{m(s.exempt_sales)}</dd></div>
            <div><dt>{t("adm.fin.fx.salesTaxShort")}</dt><dd>{m(s.sales_tax)}</dd></div>
            <div><dt>{t("adm.fin.fx.costsAll")}</dt><dd>{m(s.opex.total + s.cogs.total_all)}</dd></div>
            <div className={s.net_income < 0 ? "neg" : "pos"}><dt>{t("adm.fin.fx.netIncome")}</dt><dd>{m(s.net_income)}</dd></div>
          </dl>
        )}
        <p className="fx-note"><Icon name="info" size={12} /> {t("adm.fin.fx.hint")}</p>
      </div>
    </Modal>
  );
}
