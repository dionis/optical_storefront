// Dónde se usa: menú Tiendas → «Contabilidad por categorías» (?tab=finreport),
// solo dueño y superadmin. Dueño, 17-nov-2026: «debe salir algún reporte con
// filtro para ver toda la contabilidad y las finanzas por categorías de costo
// y se debe poder exportar a PDF».
//
// Toda la contabilidad del período por categorías: ingresos, costo de lo
// vendido (monturas, lentes, tratamientos, fijos por venta como el
// laboratorio, otros) y gastos de operación por categoría fiscal (renta,
// nómina, servicios…, comisiones del cobro y de vendedores). Cada categoría se
// abre en sus partidas: los conceptos del costo de mercancía, cada partida de
// costo (con tienda, proveedor y frecuencia) y cada vendedor.
//
// Filtros: tienda y período de la barra global (meses completos), agrupar por
// mes/trimestre/año, columnas por período o por tienda, categorías (chips con
// atajos), buscar partida/proveedor/vendedor, ver partidas y mostrar ceros.
// PDF, Excel y CSV desde la barra global: lo que se ve es lo que sale (el
// Excel/CSV lleva además una hoja con todas las partidas de las categorías
// elegidas).
//
// Datos: GET /admin/finance/category-report (lib/category-report.ts), el mismo
// libro que el Resultado por tienda y el Estado de resultados. Filas: el
// modelo puro finance/categoryReport.js (scripts/test-category-report.mjs).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { money } from "./adminOrders.js";
import Icon from "./icons.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { usePeriodFilter } from "./periodStore.js";
import { menuHandlers, useRegisterExport } from "./GlobalFilterBar.jsx";
import { fetchCategoryReport } from "./finance/financeApi.js";
import { categoriesOf, columnsOf, costShares, rowsOf, SECTIONS } from "./finance/categoryReport.js";
import { store as ls } from "./finance/model.js";
import "./finance-report.css";

const CATS = categoriesOf();
const COSTS = CATS.filter((c) => c.section !== "revenue").map((c) => c.id);
const OPEX = CATS.filter((c) => c.section === "opex").map((c) => c.id);
const SUM_KEY = { revenue: "adm.frp.sum.revenue", cogs: "adm.frp.sum.cogs", opex: "adm.frp.sum.opex" };
const SEC_KEY = { revenue: "adm.fin.st.l.h.revenue", cogs: "adm.fin.st.l.h.cogs", opex: "adm.fin.st.l.h.opex" };
const RES_KEY = { gross_profit: "adm.fin.st.l.gross_profit", net_income: "adm.fin.st.l.net_income", net_margin: "adm.fin.st.l.net_margin", selected_costs: "adm.frp.res.selected_costs" };

export default function FinanceReport({ me }) {
  const { t, lang } = useLang();
  const sf = useStoreFilter(me);
  const { from, to, label: periodName } = usePeriodFilter();
  const saved = useMemo(() => ls.get("adm.frp", {}), []);
  const [group, setGroup] = useState(["month", "quarter", "year"].includes(saved.group) ? saved.group : "month");
  const [layout, setLayout] = useState(saved.layout === "stores" ? "stores" : "periods");
  const [sel, setSel] = useState(() => (Array.isArray(saved.sel) ? new Set(saved.sel) : null));
  const [detail, setDetail] = useState(saved.detail === true);
  const [showZero, setShowZero] = useState(false);
  const [q, setQ] = useState("");
  const [openMap, setOpenMap] = useState({});
  const [doc, setDoc] = useState(null);
  const [state, setState] = useState("loading");
  const tableRef = useRef(null);

  useEffect(() => { ls.set("adm.frp", { group, layout, detail, sel: sel ? [...sel] : null }); }, [group, layout, detail, sel]);

  // Solo pinta la última petición (cambiar de tienda o de período deprisa no mezcla respuestas).
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    setState("loading");
    fetchCategoryReport({ from, to, store: sf.storeId || "all", group })
      .then((d) => { if (n === seq.current) { setDoc(d); setState("ok"); } })
      .catch((e) => { if (n === seq.current) setState(e.message || "adm.err.fin.load_failed"); });
  }, [from, to, sf.storeId, group]);
  useEffect(load, [load]);

  const m = (v) => (v === null || v === undefined ? "—" : money(Number(v), "usd", lang));
  const pct = (v) => (v === null || v === undefined ? "" : `${v} %`);
  const dateLocale = lang === "en" ? "en-US" : "es-US";
  const periodLabel = useCallback((p) => {
    if (p === "all") return t("adm.frp.total");
    if (/^\d{4}-Q\d$/.test(p)) return t("adm.fin.st.quarterN", { q: p.slice(-1), y: p.slice(0, 4) });
    if (/^\d{4}$/.test(p)) return p;
    const [y, mo] = p.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(dateLocale, { month: "short", year: "numeric" });
  }, [t, dateLocale]);
  const entName = (e) => (e.kind === "web" ? t("adm.fin.st.web") : `${e.code} · ${e.name}`);

  const multiStore = (doc?.entities || []).filter((e) => e.kind !== "total").length > 1;
  const effLayout = multiStore ? layout : "periods";
  const cols = useMemo(() => columnsOf(doc, effLayout), [doc, effLayout]);
  const colLabel = (c) => (c.kind === "total" ? t("adm.frp.total") : c.kind === "entity" ? (c.ent.kind === "web" ? t("adm.fin.st.web") : c.ent.code) : periodLabel(c.period));

  // Textos de las piezas: nombre, y lo que dice de dónde es (tienda, proveedor, frecuencia, tipo).
  const freqText = (it) => (it.frequency === "per_sale" ? t("adm.frp.perSale") : it.frequency ? t(`adm.costs2.freq.${it.frequency}`) : "");
  const detailName = (d) => (d.kind === "item" ? d.item.description || t("adm.frp.noName") : d.kind === "seller" ? d.seller.name || d.seller.seller_code || (d.seller.is_owner ? t("adm.frp.owner") : d.seller.seller_id ? t("adm.frp.unnamed") : t("adm.frp.noSeller")) : d.label);
  const detailSub = (d) => {
    if (d.kind === "item") return [d.item.owner_store || t("adm.frp.sharedStore"), d.item.vendor, freqText(d.item), t(`adm.frp.bucket.${d.item.bucket}`)].filter(Boolean).join(" · ");
    if (d.kind === "seller") return [d.seller.name && d.seller.seller_code ? d.seller.seller_code : null, t("adm.frp.sellerSub", { net: m(d.seller.net_sales) })].filter(Boolean).join(" · ");
    return "";
  };
  const catLabel = (c) => t(c.label);

  const isOpen = useCallback((id) => (openMap[id] ?? detail), [openMap, detail]);
  const rows = useMemo(
    () => rowsOf(doc, cols, { selected: sel, open: isOpen, showZero, q, labelOf: catLabel, detailText: detailName, matchText: (d) => `${detailName(d)} ${detailSub(d)}` }),
    [doc, cols, sel, isOpen, showZero, q, lang] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const totalCol = cols[cols.length - 1];
  const rowLabel = (r) => {
    if (r.type === "sec") return t(SEC_KEY[r.section]);
    if (r.type === "sum") return r.complete ? t(SUM_KEY[r.section]) : t("adm.frp.sum.partial", { label: t(SUM_KEY[r.section]) });
    if (r.type === "res") return t(RES_KEY[r.id]);
    return r.label;
  };
  const cellText = (r, c) => {
    if (r.type === "sec") return "";
    const v = r.values[c.key];
    if (r.isPct) return v == null ? "—" : pct(v);
    return m(v);
  };

  const all = doc?.statements?.all?.total || null;
  const selCount = sel ? sel.size : CATS.length;
  const shares = useMemo(() => costShares(doc, sel), [doc, sel]);
  const filtered = Boolean(sel) || Boolean(q.trim());

  // ── Filtro de categorías ──
  const toggleCat = (id) => setSel((cur) => {
    const next = new Set(cur || CATS.map((c) => c.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next.size === CATS.length ? null : next;
  });
  const quick = (ids) => setSel(ids ? new Set(ids) : null);
  const catTotal = (c) => (all ? Number(c.get(all)) || 0 : 0);
  const chipCats = CATS.filter((c) => showZero || catTotal(c) || (sel && sel.has(c.id)));
  const openCat = (id) => {
    setOpenMap((o) => ({ ...o, [id]: true }));
    if (sel && !sel.has(id)) toggleCat(id);
    requestAnimationFrame(() => tableRef.current?.querySelector(`[data-cat="${id}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" }));
  };
  const setAllOpen = (v) => { setDetail(v); setOpenMap({}); };

  // ── Exportar (PDF · Excel · CSV desde la barra global) ──
  const scopeText = sf.storeId && sf.storeId !== "all" ? (sf.store ? (sf.isWeb ? t("adm.fin.st.web") : `${sf.store.code} · ${sf.store.name}`) : sf.storeId) : t("adm.theme.allStores");
  const monthsText = doc ? t("adm.frp.months", { from: periodLabel(doc.months[0]), to: periodLabel(doc.months[doc.months.length - 1]) }) : "";
  const groupText = effLayout === "stores" ? t("adm.frp.storesCols") : t("adm.frp.groupBy", { g: t(`adm.fin.st.g.${group}`).toLowerCase() });
  const report = useCallback((kind) => {
    if (!doc || !all) return null;
    const concept = {
      header: t("adm.frp.concept"), width: 36,
      get: (r) => (r.type === "det" ? `   ${r.label}${detailSub(r.detail) ? ` (${detailSub(r.detail)})` : ""}` : rowLabel(r)),
      text: (r) => (r.type === "det" ? `· ${r.label}${detailSub(r.detail) ? ` — ${detailSub(r.detail)}` : ""}` : rowLabel(r)),
    };
    const moneyCols = cols.map((c) => ({ header: colLabel(c), key: c.key, type: "money", width: 13, get: (r) => (r.type === "sec" || r.isPct ? null : r.values[c.key]), text: (r) => cellText(r, c) }));
    const pctCol = { header: t("adm.frp.pctRev"), key: "pct", width: 9, align: "r", get: (r) => r.pct ?? null, text: (r) => pct(r.pct) };
    const main = { title: t("adm.frp.sheet.main"), sheet: t("adm.frp.sheet.main"), cols: [concept, ...moneyCols, pctCol], rows, main: true, empty: t("adm.frp.empty"), rowCls: (r) => `frp-${r.type}` };
    const tables = [main];
    // Excel y CSV: además, todas las partidas de las categorías elegidas (abiertas o no), una por fila.
    if (kind !== "pdf") {
      const flat = [];
      for (const c of CATS) {
        if (sel && !sel.has(c.id)) continue;
        if (!c.details) continue;
        const total = catTotal(c);
        for (const d of c.details(doc)) {
          if (!showZero && !Number(d.amounts.total)) continue;
          const text = `${detailName(d)} ${detailSub(d)}`.toLowerCase();
          if (q.trim() && !text.includes(q.trim().toLowerCase()) && !t(c.label).toLowerCase().includes(q.trim().toLowerCase())) continue;
          flat.push({
            category: t(c.label), item: detailName(d), kind: t(`adm.frp.kind.${d.kind}`),
            store: d.kind === "item" ? d.item.owner_store || t("adm.frp.sharedStore") : "",
            vendor: d.kind === "item" ? d.item.vendor || "" : d.kind === "seller" ? d.seller.seller_code || "" : "",
            freq: d.kind === "item" ? `${freqText(d.item)} · ${t(`adm.frp.bucket.${d.item.bucket}`)}` : "",
            amount: Number(totalCol.amountOf(d.amounts)) || 0,
            share: total > 0 ? Math.round(((Number(d.amounts.total) || 0) / total) * 1000) / 10 : null,
          });
        }
      }
      tables.push({
        title: t("adm.frp.sheet.detailTitle"), sheet: t("adm.frp.sheet.detail"),
        cols: [
          { header: t("adm.frp.col.category"), key: "category", width: 26 },
          { header: t("adm.frp.col.item"), key: "item", width: 30 },
          { header: t("adm.frp.col.kind"), key: "kind", width: 16 },
          { header: t("adm.frp.col.store"), key: "store", width: 10 },
          { header: t("adm.frp.col.vendor"), key: "vendor", width: 16 },
          { header: t("adm.frp.col.freq"), key: "freq", width: 18 },
          { header: t("adm.frp.col.amount"), key: "amount", type: "money", width: 13 },
          { header: t("adm.frp.col.share"), key: "share", width: 10, text: (r) => pct(r.share) },
        ],
        rows: flat,
        empty: t("adm.frp.empty"),
      });
    }
    const store = sf.storeId && sf.storeId !== "all" && sf.store && !sf.isWeb ? { code: sf.store.code, name: sf.store.name, color: sf.store.color, address: sf.store.address, phone: sf.store.phone } : null;
    const filters = [
      filtered && sel ? `${t("adm.frp.cats")}: ${selCount}/${CATS.length}` : null,
      q.trim() ? `"${q.trim()}"` : null,
    ].filter(Boolean);
    return {
      title: t("adm.frp.title"),
      subtitle: `${t("adm.frp.subtitle", { scope: scopeText, months: monthsText, group: groupText })}${filters.length ? ` · ${t("adm.frp.filters", { list: filters.join(", ") })}` : ""}`,
      store,
      period: { from: doc.from, to: doc.to },
      kpis: [
        { label: t("adm.frp.kpi.revenue"), value: m(all.revenue.total), sub: t("adm.frp.kpi.sales", { n: all.sales_count }) },
        { label: t("adm.frp.kpi.cogs"), value: m(all.cogs.total_all), sub: all.revenue.total ? t("adm.frp.kpi.ofRevenue", { pct: pct(Math.round((all.cogs.total_all / all.revenue.total) * 1000) / 10) }) : "" },
        { label: t("adm.frp.kpi.opex"), value: m(all.opex.total), sub: all.revenue.total ? t("adm.frp.kpi.ofRevenue", { pct: pct(Math.round((all.opex.total / all.revenue.total) * 1000) / 10) }) : "" },
        { label: t("adm.frp.kpi.net"), value: m(all.net_income), neg: all.net_income < 0, tone: all.net_income < 0 ? "bad" : "good", sub: all.pct.net_margin == null ? "" : t("adm.frp.kpi.margin", { pct: pct(all.pct.net_margin) }) },
        { label: t("adm.frp.kpi.tax"), value: m(all.sales_tax) },
      ],
      summaries: [],
      tables: [
        ...tables,
        ...(shares.length ? [{
          title: t("adm.frp.shares"), sheet: t("adm.frp.shares"), note: t("adm.frp.sharesNote"),
          cols: [
            { header: t("adm.frp.col.category"), key: "name", width: 40 },
            { header: t("adm.frp.col.amount"), key: "amount", type: "money", width: 16 },
            { header: t("adm.frp.col.shareCosts"), key: "share", width: 14, align: "r", text: (r) => pct(r.share) },
          ],
          rows: shares.map((x) => ({ name: t(x.label), amount: x.amount, share: x.share })),
        }] : []),
      ],
      landscape: cols.length > 4,
      lang,
      t,
      filename: `contabilidad-categorias-${store ? store.code : sf.isWeb ? "web" : "todas"}-${doc.from.slice(0, 7)}-${doc.to.slice(0, 7)}`,
    };
  }, [doc, all, rows, cols, sel, q, showZero, shares, lang, t, effLayout, group, sf.storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sin «versión para compartir»: es la contabilidad del dueño (la versión para compartir quita costos y
  // márgenes, que aquí son todo el documento), así que cada botón saca el informe completo de una pulsación.
  useRegisterExport(doc ? { ...menuHandlers({ report, title: t("adm.frp.title"), name: "contabilidad-categorias" }), audiences: false } : null);

  const empty = doc && all && !all.revenue.total && !all.cogs.total_all && !all.opex.total;

  return (
    <div className="adm-section frp">
      <div className="adm-head-row frp-head">
        <h2><Icon name="layers" size={20} /> {t("adm.frp.title")}</h2>
        <div className="frp-scope">
          <span className="adm-chip neutral" title={t("adm.frp.monthsHint")}><Icon name="calendar" size={12} /> {monthsText || periodName(t)}</span>
          <span className="adm-chip neutral"><Icon name="store" size={12} /> {scopeText}</span>
        </div>
      </div>
      <p className="frp-lead">{t("adm.frp.lead")}</p>

      {/* Filtros propios (tienda y período: barra global) */}
      <div className="frp-bar" role="group" aria-label={t("adm.frp.cats")}>
        <div className="frp-bar-row">
          <label className="frp-field">{t("adm.frp.group")}
            <span className="frp-seg" role="tablist">
              {["month", "quarter", "year"].map((g) => <button key={g} type="button" role="tab" aria-selected={group === g} className={group === g ? "on" : ""} onClick={() => setGroup(g)} disabled={effLayout === "stores"}>{t(`adm.fin.st.g.${g}`)}</button>)}
            </span>
          </label>
          {multiStore && (
            <label className="frp-field">{t("adm.frp.layout")}
              <span className="frp-seg" role="tablist">
                {[["periods", "adm.fin.st.lay.periods"], ["stores", "adm.fin.st.lay.entities"]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={layout === k} className={layout === k ? "on" : ""} onClick={() => setLayout(k)}>{t(l)}</button>)}
              </span>
            </label>
          )}
          <label className="frp-search">
            <Icon name="search" size={14} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("adm.frp.search")} aria-label={t("adm.frp.search")} />
            {q && <button type="button" className="frp-x" onClick={() => setQ("")} aria-label={t("adm.frp.clearSearch")}><Icon name="close" size={12} /></button>}
          </label>
          <label className="frp-check"><input type="checkbox" checked={detail} onChange={(e) => setAllOpen(e.target.checked)} /> {t("adm.frp.detail")}</label>
          <label className="frp-check"><input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> {t("adm.frp.zero")}</label>
        </div>
        <div className="frp-cats">
          <span className="frp-cats-label">{t("adm.frp.cats")}</span>
          <span className="frp-quick">
            <button type="button" className={!sel ? "on" : ""} onClick={() => quick(null)}>{t("adm.frp.all")}</button>
            <button type="button" className={sel && sel.size === COSTS.length && COSTS.every((id) => sel.has(id)) ? "on" : ""} onClick={() => quick(COSTS)}>{t("adm.frp.onlyCosts")}</button>
            <button type="button" className={sel && sel.size === OPEX.length && OPEX.every((id) => sel.has(id)) ? "on" : ""} onClick={() => quick(OPEX)}>{t("adm.frp.onlyOpex")}</button>
            <button type="button" className={sel && sel.size === 0 ? "on" : ""} onClick={() => quick([])}>{t("adm.frp.none")}</button>
          </span>
          {SECTIONS.map((section) => {
            const list = chipCats.filter((c) => c.section === section);
            if (!list.length) return null;
            return (
              <span key={section} className={`frp-chipset ${section}`}>
                <small>{t(SEC_KEY[section])}</small>
                {list.map((c) => {
                  const on = !sel || sel.has(c.id);
                  return (
                    <button key={c.id} type="button" className={`frp-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleCat(c.id)}>
                      {on && <Icon name="check" size={11} />} {t(c.label)} <b>{m(catTotal(c))}</b>
                    </button>
                  );
                })}
              </span>
            );
          })}
        </div>
      </div>

      {state === "loading" && !doc && <div className="adm-src-note loading">{t("adm.frp.loading")}</div>}
      {state !== "ok" && state !== "loading" && (
        <div className="adm-login-err">{t(state)} <button type="button" className="btn-xs" onClick={load}>{t("adm.fin.retry")}</button></div>
      )}

      {doc && all && (
        <div className={`frp-body ${state === "loading" ? "is-loading" : ""}`}>
          <div className="frp-kpis">
            <div className="frp-kpi"><small>{t("adm.frp.kpi.revenue")}</small><b>{m(all.revenue.total)}</b><i>{t("adm.frp.kpi.sales", { n: all.sales_count })}</i></div>
            <div className="frp-kpi"><small>{t("adm.frp.kpi.cogs")}</small><b>{m(all.cogs.total_all)}</b><i>{all.revenue.total ? t("adm.frp.kpi.ofRevenue", { pct: pct(Math.round((all.cogs.total_all / all.revenue.total) * 1000) / 10) }) : ""}</i></div>
            <div className="frp-kpi"><small>{t("adm.frp.kpi.opex")}</small><b>{m(all.opex.total)}</b><i>{all.revenue.total ? t("adm.frp.kpi.ofRevenue", { pct: pct(Math.round((all.opex.total / all.revenue.total) * 1000) / 10) }) : ""}</i></div>
            <div className={`frp-kpi ${all.net_income < 0 ? "bad" : "good"}`}><small>{t("adm.frp.kpi.net")}</small><b>{m(all.net_income)}</b><i>{all.pct.net_margin == null ? "" : t("adm.frp.kpi.margin", { pct: pct(all.pct.net_margin) })}</i></div>
            <div className="frp-kpi muted"><small>{t("adm.frp.kpi.tax")}</small><b>{m(all.sales_tax)}</b><i /></div>
          </div>

          {shares.length > 0 && (
            <section className="frp-shares" aria-label={t("adm.frp.shares")}>
              <h3>{t("adm.frp.shares")} <small>{t("adm.frp.sharesHint")}</small></h3>
              <ul>
                {shares.slice(0, 10).map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => openCat(s.id)}>
                      <span className="frp-share-name">{t(s.label)}</span>
                      <span className="frp-share-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, s.share)}%` }} /></span>
                      <span className="frp-share-val">{m(s.amount)} <small>{pct(s.share)}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {filtered && <p className="frp-note"><Icon name="filter" size={12} /> {t("adm.frp.partial", { n: selCount, m: CATS.length })}</p>}

          {empty && !filtered ? (
            <div className="adm-empty">{t("adm.frp.empty")}</div>
          ) : rows.length === 0 ? (
            <div className="adm-empty">{t("adm.frp.noMatch")}</div>
          ) : (
            <div className="frp-table-wrap">
              <div className="frp-table-tools">
                <button type="button" className="btn-xs" onClick={() => setAllOpen(!detail)}><Icon name={detail ? "chevronUp" : "chevronDown"} size={12} /> {detail ? t("adm.frp.collapseAll") : t("adm.frp.expandAll")}</button>
              </div>
              <div className="frp-scroll" ref={tableRef}>
                <table className="frp-table">
                  <thead>
                    <tr>
                      <th scope="col" className="c">{t("adm.frp.concept")}</th>
                      {cols.map((c) => <th key={c.key} scope="col" className={c.kind === "total" ? "tot" : ""} title={c.kind === "entity" ? entName(c.ent) : undefined} style={c.ent?.color ? { boxShadow: `inset 0 3px 0 ${c.ent.color}` } : undefined}>{colLabel(c)}</th>)}
                      <th scope="col" className="pc" title={t("adm.frp.pctRevHint")}>{t("adm.frp.pctRev")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      if (r.type === "sec") return <tr key={r.id} className="sec"><th colSpan={cols.length + 2} scope="rowgroup">{rowLabel(r)}</th></tr>;
                      const open = r.type === "cat" && r.expandable && (isOpen(r.id) || Boolean(q.trim()));
                      return (
                        <tr key={r.id} className={`${r.type} ${r.type === "res" ? `res-${r.id}` : ""}`} data-cat={r.type === "cat" ? r.id : undefined}>
                          <th scope="row" className="c">
                            {r.type === "cat" && r.expandable ? (
                              <button type="button" className="frp-toggle" aria-expanded={open} onClick={() => setOpenMap((o) => ({ ...o, [r.id]: !isOpen(r.id) }))} aria-label={t("adm.frp.toggle", { cat: r.label })}>
                                <Icon name={open ? "chevronDown" : "chevronRight"} size={12} /> {r.label} <small>{t("adm.frp.parts", { n: r.count })}</small>
                              </button>
                            ) : r.type === "det" ? (
                              <span className="frp-det">
                                <span>{r.label}</span>
                                {detailSub(r.detail) && <small>{detailSub(r.detail)}</small>}
                              </span>
                            ) : (
                              <span className="frp-lbl">{rowLabel(r)}</span>
                            )}
                          </th>
                          {cols.map((c) => {
                            const v = r.values[c.key];
                            const neg = (r.type === "res" && !r.isPct && Number(v) < 0);
                            return <td key={c.key} data-label={colLabel(c)} className={`${c.kind === "total" ? "tot" : ""} ${neg ? "neg" : ""}`} title={v === null && r.type === "det" ? t("adm.frp.byStoreUnknown") : undefined}>{cellText(r, c)}</td>;
                          })}
                          <td className="pc" data-label={t("adm.frp.pctRev")}>{pct(r.pct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="frp-prep"><Icon name="info" size={12} /> {t("adm.fin.st.preparer")}</p>
        </div>
      )}
    </div>
  );
}
