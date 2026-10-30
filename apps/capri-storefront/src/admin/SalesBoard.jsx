// Dónde se usa: pestaña «Panel de ventas» de /admin — ventas y ganancia de cada
// usuario dentro de lo suyo: el dueño y los superadmin todo (tiendas y web), el
// supervisor y el encargado sus tiendas (HU-67), el vendedor sus propias ventas
// con su comisión. Periodo → por hora, día, mes o año → por tienda, vendedor o
// producto; un clic en una fila filtra todo el panel y baja un nivel (tienda →
// sus vendedores → sus productos) hasta las ventas sueltas. Tanto el alcance como
// quién ve la ganancia los decide el servidor (GET /admin/sales-analytics/insights).
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useLensCatalog } from "../data/lensCatalog.js";
import Icon from "./icons.jsx";
import { KpiCard, TrendChart } from "./charts.jsx";
import { Card, SubTabs } from "./ui.jsx";
import { money } from "./adminOrders.js";
import { adminFetch, ADMIN_API_URL } from "./adminApi.js";
import { getSession } from "./adminApi.js";
import { methodName, posContext } from "./posApi.js";

const PRIMARY = ["establishment", "seller", "product"];
const MORE = ["brand", "category", "lens_design", "lens_material", "lens_photo", "lens_ar", "payment_method", "terminal"];
const GRAINS = ["hour", "day", "month", "year"];
const PERIODS = ["today", "yesterday", "7d", "30d", "month", "lastMonth", "year", "5y", "date"];
// Qué filtro aplica un clic en una fila, y a qué nivel baja después.
const FOCUS_PARAM = { establishment: "stores", seller: "seller_codes", product: "products", brand: "brands", category: "categories", lens_design: "lens_designs", payment_method: "payment_methods" };
const NEXT_LEVEL = { establishment: "seller", seller: "product", brand: "product", category: "product", lens_design: "product", payment_method: "product" };
const COLOR_SALES = "#6366f1";
const COLOR_SECOND = "#0d9488";
const COLOR_WEB = "#0891b2";
// Validada (validate_palette.js): daltonismo y contraste sobre fondo claro.
const SERIES_COLORS = ["#6366f1", "#ea580c", "#0891b2", "#a16207", "#c026d3"];
const RANK_PREVIEW = 10;

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function periodRange(period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const ago = (n) => ymd(new Date(y, m, now.getDate() - n));
  switch (period) {
    case "yesterday": return { from: ago(1), to: ago(1) };
    case "7d": return { from: ago(6), to: ago(0) };
    case "30d": return { from: ago(29), to: ago(0) };
    case "month": return { from: ymd(new Date(y, m, 1)), to: ago(0) };
    case "lastMonth": return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "year": return { from: `${y}-01-01`, to: ago(0) };
    case "5y": return { from: `${y - 4}-01-01`, to: ago(0) };
    default: return { from: ago(0), to: ago(0) };
  }
}

const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  return p.toString();
};

function delta(cur, prev) {
  if (!prev) return {};
  const d = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  return { delta: `${Math.abs(d)} %`, deltaGood: d >= 0 };
}

/** La etiqueta de un punto de la serie, en el idioma elegido. */
function bucketLabel(bucket, grain, lang) {
  const locale = lang === "en" ? "en-US" : "es";
  if (grain === "hour") return new Date(2000, 0, 1, Number(bucket)).toLocaleTimeString(locale, { hour: "numeric" });
  if (grain === "year") return bucket;
  if (grain === "month") return new Date(`${bucket}-15T12:00:00`).toLocaleDateString(locale, { month: "short", year: "2-digit" });
  return new Date(`${bucket}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** ¿A dónde va lo vendido? Una sola barra que suma el total, con el importe de cada parte. */
function MoneySplit({ totals, m, t }) {
  const parts = [
    { key: "profit", color: COLOR_SECOND, value: totals.profit },
    { key: "cost", color: "#6366f1", value: totals.cost },
    { key: "commission", color: "#ea580c", value: totals.commission },
    { key: "fee", color: "#a16207", value: totals.fee },
    { key: "tax", color: "#94a3b8", value: totals.tax },
  ];
  const base = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (!base) return <div className="adm-nodata">{t("adm.chart.noData")}</div>;
  return (
    <>
      <div className="ins-split" role="img" aria-label={parts.map((p) => `${t(`adm.ins.part.${p.key}`)}: ${m(p.value)}`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p) => <i key={p.key} style={{ width: `${(p.value / base) * 100}%`, background: p.color }} />)}
      </div>
      <ul className="ins-split-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span><i style={{ background: p.color }} />{t(`adm.ins.part.${p.key}`)}</span>
            <b className={p.value < 0 ? "ins-neg" : ""}>{m(p.value)}</b>
            <small>{Math.round((p.value / base) * 100)} %</small>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function SalesBoard({ go, tabs = [] }) {
  const { t, lang } = useLang();
  const { DESIGNS, MATERIALS, PHOTO, AR } = useLensCatalog();
  const [ctx, setCtx] = useState(null);
  const [period, setPeriod] = useState("30d");
  const [f, setF] = useState({ ...periodRange("30d"), stores: [], payment_methods: [], categories: [], rx: "" });
  const [grain, setGrain] = useState(null); // null = la que convenga al periodo
  const [by, setBy] = useState("establishment");
  const [focus, setFocus] = useState([]); // [{ by, key, label }]
  const [metric, setMetric] = useState("sales");
  const [ins, setIns] = useState(null);
  const [summary, setSummary] = useState(null);
  const [state, setState] = useState("loading");
  const [showAll, setShowAll] = useState(false);
  const [showSales, setShowSales] = useState(false);
  const [sales, setSales] = useState([]);
  // El color sigue a la entidad: quien tuvo un color lo conserva al filtrar.
  const colors = useRef(new Map());

  useEffect(() => { posContext().then(setCtx).catch(() => setCtx({ stores: [], payment_methods: [] })); }, []);

  const filters = useMemo(() => {
    const extra = {};
    for (const x of focus) {
      if (x.by === "product" && x.key === "own_frame") extra.categories = ["own_frame"];
      else extra[FOCUS_PARAM[x.by]] = [x.key];
    }
    return { ...f, ...extra };
  }, [f, focus]);
  const query = useMemo(() => qs(filters), [filters]);

  useEffect(() => {
    let on = true;
    setState("loading");
    Promise.all([
      adminFetch(`/admin/sales-analytics/insights?${query}&${qs({ grain, by })}`),
      adminFetch(`/admin/sales-analytics/summary?${query}`),
    ])
      .then(([a, b]) => { if (on) { setIns(a); setSummary(b); setState("ok"); } })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [query, grain, by]);
  useEffect(() => {
    if (!showSales) return undefined;
    let on = true;
    adminFetch(`/admin/sales-analytics/sales?${query}`).then((r) => on && setSales(r.sales || [])).catch(() => on && setSales([]));
    return () => { on = false; };
  }, [showSales, query]);

  const access = ins?.access;
  const isSeller = access?.role === "seller";
  const moreStores = (ctx?.stores?.length || 0) > 1 || ctx?.is_admin;
  // El vendedor ve sus propias ventas: agrupar por vendedor, o por su única tienda, no le dice nada.
  useEffect(() => { if (isSeller && (by === "seller" || (by === "establishment" && !moreStores))) setBy("product"); }, [isSeller, by, moreStores]);
  const second = access?.profit ? "profit" : access?.commission ? "commission" : null;
  const shownMetric = metric === "sales" || !second ? "sales" : second;

  const m = (v) => money(v, "usd", lang);
  // El eje solo tiene sitio para "$1.5k": el formato compacto en español ("1 mil US$") no cabe.
  const compactMoney = (v) => {
    const abs = Math.abs(v);
    const n = abs >= 1e6 ? `${(abs / 1e6).toLocaleString(lang === "en" ? "en-US" : "es", { maximumFractionDigits: 1 })}M` : abs >= 1e3 ? `${(abs / 1e3).toLocaleString(lang === "en" ? "en-US" : "es", { maximumFractionDigits: 2 })}k` : String(Math.round(abs));
    return `${v < 0 ? "-" : ""}$${n}`;
  };
  const storeLabel = (id) => (id === "web" ? t("adm.board.web") : ctx?.stores.find((s) => s.id === id)?.code || id || "—");
  const L = (o) => (o ? o[lang] ?? o.es : null);
  const label = (r) => {
    if (r.key === null || r.key === undefined) return by === "seller" ? t("adm.ins.noSeller") : t("adm.board.none");
    switch (by) {
      case "establishment": return r.key === "web" ? t("adm.board.web") : r.label || storeLabel(r.key);
      case "seller": return r.label ? `${r.label} (${r.key})` : r.key;
      case "product": return r.key === "own_frame" ? t("adm.board.cat.own_frame") : r.label || r.key;
      case "category": return t(`adm.board.cat.${r.key}`);
      case "lens_design": return L(DESIGNS.find((d) => d.id === r.key)?.label) || r.key;
      case "lens_material": return L(MATERIALS.find((d) => d.id === r.key)?.label) || r.key;
      case "lens_photo": return L(PHOTO.find((d) => d.id === r.key)?.label) || r.key;
      case "lens_ar": return L([...(AR.sv || []), ...(AR.bifprog || [])].find((d) => d.id === r.key)?.label) || r.key;
      case "payment_method": return methodName(ctx?.payment_methods.find((x) => x.code === r.key), t, lang) || r.key;
      case "terminal": return ctx?.stores.flatMap((s) => s.terminals).find((x) => x.id === r.key)?.code || r.key;
      default: return r.key;
    }
  };
  const colorOf = (key, own) => {
    if (own) return own;
    if (key === "web") return COLOR_WEB;
    const id = `${by}:${key}`;
    if (!colors.current.has(id)) colors.current.set(id, SERIES_COLORS[[...colors.current.keys()].filter((k) => k.startsWith(`${by}:`)).length % SERIES_COLORS.length]);
    return colors.current.get(id);
  };

  const pickPeriod = (p) => {
    setPeriod(p);
    setGrain(null);
    if (p === "date") setF((x) => ({ ...x, to: x.from }));
    else setF((x) => ({ ...x, ...periodRange(p) }));
  };
  const setDate = (k, v) => {
    if (!v) return;
    setGrain(null);
    setF((x) => (period === "date" ? { ...x, from: v, to: v } : { ...x, [k]: v }));
  };
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const canDrill = (r) => r.key !== null && r.key !== undefined && Boolean(FOCUS_PARAM[by]);
  const drill = (r) => {
    if (!canDrill(r)) return;
    setFocus((x) => [...x.filter((y) => y.by !== by), { by, key: r.key, label: label(r) }]);
    setShowAll(false);
    let next = NEXT_LEVEL[by];
    if (next === "seller" && isSeller) next = "product";
    if (next) setBy(next);
  };

  const exportCsv = async () => {
    const s = getSession();
    const res = await fetch(`${ADMIN_API_URL}/admin/sales-analytics/export?${query}`, { headers: { Authorization: `Bearer ${s?.token}` } });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ventas_${f.from}_${f.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const cur = ins?.totals;
  const prev = ins?.previous;
  const usedGrain = ins?.grain;
  const series = ins?.series || [];
  const labels = series.map((p) => bucketLabel(p.bucket, usedGrain, lang));
  const trendSeries = [
    { key: "sales", label: t("adm.board.kpi.total"), color: COLOR_SALES, values: series.map((p) => p.sales) },
    ...(second ? [{ key: second, label: t(`adm.ins.metric.${second}`), color: COLOR_SECOND, values: series.map((p) => p[second]) }] : []),
  ];
  const rows = [...(ins?.rows || [])].sort((a, b) => b[shownMetric] - a[shownMetric]);
  const visibleRows = showAll ? rows : rows.slice(0, RANK_PREVIEW);
  const rankMax = Math.max(0, ...rows.map((r) => r[shownMetric])) || 1;
  const compare = (ins?.compare || []).map((c) => ({ key: c.key, label: label({ key: c.key, label: c.label }), color: colorOf(c.key, c.color), values: c[shownMetric] }));
  const bestBucket = series.reduce((best, p) => (p.sales > (best?.sales ?? 0) ? p : best), null);
  const topRow = ins?.rows?.[0];
  const useful = {
    hour: true,
    day: f.from !== f.to,
    month: f.from.slice(0, 7) !== f.to.slice(0, 7),
    year: f.from.slice(0, 4) !== f.to.slice(0, 4),
  };
  const dims = isSeller ? PRIMARY.filter((d) => d !== "seller" && (d !== "establishment" || moreStores)) : PRIMARY;
  const inCompare = new Set(compare.map((c) => c.key));

  return (
    <div className="adm-section pos">
      <div className="adm-head-row">
        <h2>{t("adm.tab.salesboard")}</h2>
        <button type="button" className="btn-sm" onClick={exportCsv}><Icon name="excel" size={14} /> {t("adm.board.export")}</button>
      </div>
      <p className="adm-sub">{t(isSeller ? "adm.ins.subSeller" : "adm.ins.sub")}</p>

      <div className="adm-card board-filters">
        <div className="board-chips ins-periods">
          {PERIODS.map((p) => <button key={p} type="button" className={`chip ${period === p ? "on" : ""}`} onClick={() => pickPeriod(p)}>{t(`adm.board.preset.${p}`)}</button>)}
        </div>
        <div className="pos-row">
          {period === "date" ? (
            <label>{t("adm.ins.onDate")}<input type="date" value={f.from} onChange={(e) => setDate("from", e.target.value)} /></label>
          ) : (
            <>
              <label>{t("adm.board.from")}<input type="date" value={f.from} max={f.to} onChange={(e) => setDate("from", e.target.value)} /></label>
              <label>{t("adm.board.to")}<input type="date" value={f.to} min={f.from} onChange={(e) => setDate("to", e.target.value)} /></label>
            </>
          )}
        </div>
        {moreStores && (
          <div className="board-chips">
            <b>{t("adm.board.stores")}</b>
            {(ctx?.stores || []).map((s) => <button key={s.id} type="button" className={`chip ${f.stores.includes(s.id) ? "on" : ""}`} onClick={() => toggle("stores", s.id)}>{s.code}</button>)}
            {ctx?.is_admin && <button type="button" className={`chip ${f.stores.includes("web") ? "on" : ""}`} onClick={() => toggle("stores", "web")}>{t("adm.board.web")}</button>}
          </div>
        )}
        <details className="ins-more">
          <summary><Icon name="filter" size={13} /> {t("adm.ins.moreFilters")}</summary>
          <div className="board-chips">
            <b>{t("adm.board.payment")}</b>
            {(ctx?.payment_methods || []).map((pm) => <button key={pm.code} type="button" className={`chip ${f.payment_methods.includes(pm.code) ? "on" : ""}`} onClick={() => toggle("payment_methods", pm.code)}>{methodName(pm, t, lang)}</button>)}
          </div>
          <div className="board-chips">
            <b>{t("adm.board.category")}</b>
            {["frame", "case", "own_frame"].map((c) => <button key={c} type="button" className={`chip ${f.categories.includes(c) ? "on" : ""}`} onClick={() => toggle("categories", c)}>{t(`adm.board.cat.${c}`)}</button>)}
          </div>
          <label>{t("adm.board.rx")}
            <select value={f.rx} onChange={(e) => setF((x) => ({ ...x, rx: e.target.value }))}>
              <option value="">{t("adm.board.any")}</option><option value="1">{t("adm.board.withRx")}</option><option value="0">{t("adm.board.withoutRx")}</option>
            </select>
          </label>
        </details>
      </div>

      {focus.length > 0 && (
        <div className="ins-focus">
          <b>{t("adm.ins.viewing")}</b>
          {focus.map((x) => (
            <button key={x.by} type="button" className="adm-chip neutral" onClick={() => setFocus((all) => all.filter((y) => y.by !== x.by))} aria-label={t("adm.ins.removeFocus", { label: x.label })} title={t("adm.ins.removeFocus", { label: x.label })}>
              {t(`adm.board.by.${x.by}`)}: {x.label} <Icon name="close" size={11} />
            </button>
          ))}
          <button type="button" className="btn-xs" onClick={() => setFocus([])}>{t("adm.ins.clearFocus")}</button>
        </div>
      )}

      {state === "error" && <div className="adm-demo-banner">{t("adm.err.pos.generic")}</div>}
      {state === "loading" && !ins && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      {ins?.truncated && <div className="adm-demo-banner"><Icon name="alert" size={15} /> {t("adm.ins.truncated")}</div>}
      {access?.profit && ins.cost_rules_missing && (
        <div className="adm-demo-banner">
          <Icon name="alert" size={15} /> {t("adm.ins.noCosts")}
          {tabs.includes("costs") && <button type="button" className="btn-xs" onClick={() => go?.("costs")}>{t("adm.ins.defineCosts")}</button>}
        </div>
      )}
      {access?.profit && !ins.cost_rules_missing && ins.missing_cost_lines > 0 && (
        <div className="adm-demo-banner">
          <Icon name="alert" size={15} /> {t("adm.ins.missingCosts", { n: ins.missing_cost_lines })}
          {tabs.includes("costs") && <button type="button" className="btn-xs" onClick={() => go?.("costs")}>{t("adm.ins.defineCosts")}</button>}
        </div>
      )}

      {cur && (
        <div className={`ins-body ${state === "loading" ? "busy" : ""}`} aria-busy={state === "loading"}>
          <div className="board-kpis">
            <KpiCard label={t("adm.board.kpi.total")} value={m(cur.sales)} {...delta(cur.sales, prev.sales)} icon={<Icon name="dollar" />} sub={t("adm.ins.vsPrevShort")} hint={t("adm.board.vsPrev", { v: m(prev.sales) })} />
            {second && <KpiCard label={t(`adm.ins.metric.${second}`)} value={m(cur[second])} {...delta(cur[second], prev[second])} icon={<Icon name={second === "profit" ? "trendUp" : "percent"} />} sub={second === "profit" && cur.margin_pct !== null ? t("adm.ins.marginOf", { pct: cur.margin_pct }) : t("adm.ins.vsPrevShort")} hint={t("adm.board.vsPrev", { v: m(prev[second]) })} />}
            <KpiCard label={t("adm.board.kpi.count")} value={String(cur.count)} {...delta(cur.count, prev.count)} icon={<Icon name="receipt" />} sub={t("adm.ins.unitsOf", { n: cur.units })} hint={t("adm.board.vsPrev", { v: String(prev.count) })} onClick={() => setShowSales(true)} />
            <KpiCard label={t("adm.board.kpi.avg")} value={m(cur.avg_ticket)} {...delta(cur.avg_ticket, prev.avg_ticket)} icon={<Icon name="clipboard" />} hint={t("adm.board.vsPrev", { v: m(prev.avg_ticket) })} />
            {summary && <KpiCard label={t("adm.board.kpi.discount")} value={m(summary.current.discount)} icon={<Icon name="percent" />} />}
            {summary && <KpiCard label={t("adm.board.kpi.balance")} value={m(summary.balance_due)} icon={<Icon name="wallet" />} hint={t("adm.board.kpi.balanceHint")} />}
            {summary && !isSeller && <KpiCard label={t("adm.board.kpi.insurance")} value={m(summary.insurance_due)} icon={<Icon name="clipboard" />} />}
          </div>

          {cur.count > 0 && (
            <ul className="ins-notes">
              {bestBucket && <li><Icon name="sparkles" size={14} /> {t(`adm.ins.best.${usedGrain}`, { label: bucketLabel(bestBucket.bucket, usedGrain, lang), v: m(bestBucket.sales) })}</li>}
              {topRow && topRow.key !== null && rows.length > 1 && <li><Icon name="layers" size={14} /> {t("adm.ins.leader", { dim: t(`adm.board.by.${by}`), label: label(topRow), pct: topRow.share })}</li>}
            </ul>
          )}

          <Card
            title={t(`adm.ins.trend.${second || "sales"}.${usedGrain}`)}
            name="salesTrend"
            icon="trendUp"
            hint={[usedGrain === "hour" ? t("adm.ins.hourHint") : "", second === "commission" ? t("adm.ins.commissionHint") : ""].filter(Boolean).join(" ")}
            csv={{ cols: [[t("adm.ins.period"), "label"], [t("adm.board.kpi.total"), "sales"], ...(second ? [[t(`adm.ins.metric.${second}`), second]] : []), [t("adm.board.kpi.count"), "count"], [t("adm.board.units"), "units"]], rows: series.map((p, i) => ({ ...p, label: labels[i] })) }}
            right={(
              <div className="adm-range ins-grains" role="group" aria-label={t("adm.ins.seeBy")}>
                {GRAINS.map((g) => <button key={g} type="button" className={usedGrain === g ? "on" : ""} disabled={!useful[g]} title={useful[g] ? undefined : t("adm.ins.grainNotUseful")} onClick={() => setGrain(g)}>{t(`adm.ins.grain.${g}`)}</button>)}
              </div>
            )}
          >
            <TrendChart labels={labels} series={trendSeries} format={m} axisFormat={compactMoney} tipExtra={(i) => [t("adm.ins.tipCount", { n: series[i].count, units: series[i].units })]} />
          </Card>

          {access?.profit && (
            <Card title={t("adm.ins.split")} name="salesSplit" icon="wallet" hint={t("adm.ins.profitHint")}>
              <MoneySplit totals={cur} m={m} t={t} />
            </Card>
          )}

          <Card
            title={t("adm.ins.breakdown")}
            name="salesBreakdown"
            icon="layers"
            csv={{ cols: [[t(`adm.board.by.${by}`), (r) => label(r)], [t("adm.board.kpi.total"), "sales"], ...(second ? [[t(`adm.ins.metric.${second}`), second]] : []), ...(access?.profit ? [[t("adm.ins.margin"), "margin_pct"]] : []), [t("adm.board.kpi.count"), "count"], [t("adm.board.units"), "units"], [t("adm.board.share"), "share"]], rows }}
            right={second && (
              <div className="adm-range" role="group" aria-label={t("adm.ins.metric")}>
                <button type="button" className={shownMetric === "sales" ? "on" : ""} onClick={() => setMetric("sales")}>{t("adm.board.kpi.total")}</button>
                <button type="button" className={shownMetric === second ? "on" : ""} onClick={() => setMetric("second")}>{t(`adm.ins.metric.${second}`)}</button>
              </div>
            )}
          >
            <SubTabs
              items={dims.map((d) => ({ key: d, icon: d === "establishment" ? "store" : d === "seller" ? "sellers" : "products", label: t(`adm.ins.by.${d}`) }))}
              value={by}
              onChange={(d) => { setBy(d); setShowAll(false); }}
              right={(
                <select value={MORE.includes(by) ? by : ""} onChange={(e) => { if (e.target.value) { setBy(e.target.value); setShowAll(false); } }} aria-label={t("adm.ins.otherBy")} title={t("adm.ins.otherBy")}>
                  <option value="">{t("adm.ins.otherBy")}</option>
                  {MORE.map((b) => <option key={b} value={b}>{t(`adm.board.by.${b}`)}</option>)}
                </select>
              )}
            />
            {!rows.length ? <div className="adm-nodata">{t("adm.chart.noData")}</div> : (
              <div className={`ins-split-view ${compare.length > 1 && series.length > 1 ? "two" : ""}`}>
                <div>
                  <ol className="ins-rank">
                    {visibleRows.map((r) => {
                      const value = r[shownMetric];
                      const inner = (
                        <>
                          <span className="ins-rank-name">
                            {inCompare.has(r.key) && <i style={{ background: colorOf(r.key, r.color) }} />}
                            <b>{label(r)}</b>
                          </span>
                          <span className={`ins-rank-value ${value < 0 ? "ins-neg" : ""}`}>{m(value)}</span>
                          <span className="ins-rank-track"><i style={{ width: `${Math.max(0, (value / rankMax) * 100)}%`, background: shownMetric === "sales" ? COLOR_SALES : COLOR_SECOND }} /></span>
                          <small className="muted">
                            {t("adm.ins.rowSub", { n: r.count, units: r.units, pct: r.share })}
                            {access?.profit && r.margin_pct !== null && ` · ${t("adm.ins.marginOf", { pct: r.margin_pct })}`}
                          </small>
                        </>
                      );
                      return (
                        <li key={r.key ?? "none"}>
                          {canDrill(r)
                            ? <button type="button" onClick={() => drill(r)} title={t("adm.ins.drill")}>{inner}<Icon name="chevronRight" size={15} className="ins-rank-go" /></button>
                            : <div>{inner}</div>}
                        </li>
                      );
                    })}
                  </ol>
                  {rows.length > RANK_PREVIEW && <button type="button" className="btn-xs" onClick={() => setShowAll((v) => !v)}>{showAll ? t("adm.ins.showLess") : t("adm.ins.showAll", { n: rows.length })}</button>}
                </div>
                {compare.length > 1 && series.length > 1 && (
                  <div>
                    <h4 className="ins-sub-title">{t("adm.ins.compare", { n: compare.length })}</h4>
                    <TrendChart labels={labels} series={compare} format={m} axisFormat={compactMoney} forceLines height={250} />
                  </div>
                )}
              </div>
            )}
          </Card>

          <div className="ins-sales-toggle">
            <button type="button" className="btn-sm" onClick={() => setShowSales((v) => !v)}><Icon name="receipt" size={14} /> {t(showSales ? "adm.ins.hideSales" : "adm.ins.showSales")}</button>
          </div>
          {showSales && (
            <Card title={focus.length ? t("adm.board.salesOf", { label: focus.map((x) => x.label).join(" · ") }) : t("adm.ins.allSales")} name="drill" icon="receipt">
              <table className="adm-table responsive">
                <thead><tr><th>{t("adm.pos.sales.number")}</th><th>{t("adm.pos.sales.when")}</th><th>{t("adm.pos.store")}</th><th>{t("adm.pos.sales.seller")}</th><th>{t("adm.board.items")}</th><th>{t("adm.board.kpi.total")}</th></tr></thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.order_id}>
                      <td data-label={t("adm.pos.sales.number")}><b>{s.number || t("adm.board.web")}</b></td>
                      <td data-label={t("adm.pos.sales.when")}>{new Date(s.sold_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td data-label={t("adm.pos.store")}>{s.channel === "web" ? t("adm.board.web") : storeLabel(s.establishment_id)}</td>
                      <td data-label={t("adm.pos.sales.seller")}>{s.seller_code || "—"}</td>
                      <td data-label={t("adm.board.items")}><small>{s.items.replace(/own_frame/g, t("adm.pos.own.tag"))}</small></td>
                      <td data-label={t("adm.board.kpi.total")}>{m(s.total)}</td>
                    </tr>
                  ))}
                  {sales.length === 0 && <tr><td colSpan="6" className="full"><div className="adm-nodata">{t("adm.chart.noData")}</div></td></tr>}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
