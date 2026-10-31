// Dónde se usa: pestaña «Panel de ventas» de /admin — ventas y ganancia de cada
// usuario dentro de lo suyo: el dueño y los superadmin todo (tiendas y web), el
// supervisor y el encargado sus tiendas (HU-67), el vendedor sus propias ventas
// con su comisión. Pensado como un sistema contable: una barra de filtros fija
// (periodo · día/semana/mes/año · tienda · vendedor), una tira de totales
// siempre a la vista, y acordeones (tienda, vendedor, producto, lente, pago,
// serie) con su total en la cabecera y una fila de totales al pie de cada tabla.
// Un clic en una fila filtra todo el panel y baja un nivel (tienda → vendedor →
// producto → ventas sueltas). Tanto el alcance como quién ve la ganancia los
// decide el servidor (GET /admin/sales-analytics/insights, una sola lectura con
// todas las dimensiones). Exporta a PDF (impresión aislada), Excel (.xlsx real,
// una hoja por sección) y CSV (las ventas una a una, del servidor).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useLensCatalog } from "../data/lensCatalog.js";
import Icon from "./icons.jsx";
import HelpTip from "./HelpTip.jsx";
import { TrendChart } from "./charts.jsx";
import { ExportMenu, SubTabs } from "./ui.jsx";
import { money } from "./adminOrders.js";
import { adminFetch, ADMIN_API_URL, getSession } from "./adminApi.js";
import { methodName, posContext } from "./posApi.js";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import "./sales-board.css";

const GRAINS = ["hour", "day", "week", "month", "year"];
const PERIODS = ["today", "yesterday", "week", "lastWeek", "month", "lastMonth", "year", "range"];
// Las secciones del panel y las dimensiones que agrupa cada una (pestañas dentro del acordeón).
const SECTIONS = [
  { key: "store", icon: "store", dims: ["establishment"] },
  { key: "seller", icon: "sellers", dims: ["seller"] },
  { key: "product", icon: "products", dims: ["product", "brand", "category"] },
  { key: "lens", icon: "glasses", dims: ["lens_design", "lens_material", "lens_photo", "lens_ar"] },
  { key: "payment", icon: "wallet", dims: ["payment_method", "terminal"] },
];
const ALL_DIMS = SECTIONS.flatMap((s) => s.dims);
// Qué filtro aplica un clic en una fila, y a qué sección baja después.
const FOCUS_PARAM = { establishment: "stores", seller: "seller_codes", product: "products", brand: "brands", category: "categories", lens_design: "lens_designs", payment_method: "payment_methods" };
const NEXT_SECTION = { establishment: "seller", seller: "product", brand: "product", category: "product", lens_design: "product", payment_method: "product", product: "sales" };
const COLOR_SALES = "#6366f1";
const COLOR_SECOND = "#0d9488";
const COLOR_WEB = "#0891b2";
// Validada (validate_palette.js): daltonismo y contraste sobre fondo claro.
const SERIES_COLORS = ["#6366f1", "#ea580c", "#0891b2", "#a16207", "#c026d3"];
const ROWS_PREVIEW = 12;
const LS_OPEN = "adm.sb.open.v1";
const LS_COMPARE = "adm.sb.compare.v1";
const DEFAULT_OPEN = { series: true, store: true, seller: true, product: true, lens: false, payment: false, split: false, sales: false };

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Semana ISO de un día local ("YYYY-MM-DD" → "YYYY-Www"), igual que el servidor (sales-insights.ts). */
export function isoWeekOf(day) {
  const d = new Date(Date.parse(`${day}T00:00:00Z`));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400_000 + 1) / 7);
  return `${year}-W${pad(week)}`;
}

export function periodRange(period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const ago = (n) => ymd(new Date(y, m, now.getDate() - n));
  const dow = now.getDay() || 7; // 1 = lunes … 7 = domingo
  switch (period) {
    case "yesterday": return { from: ago(1), to: ago(1) };
    case "7d": return { from: ago(6), to: ago(0) };
    case "30d": return { from: ago(29), to: ago(0) };
    case "week": return { from: ago(dow - 1), to: ago(0) };
    case "lastWeek": return { from: ago(dow + 6), to: ago(dow) };
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
  if (!prev) return null;
  const d = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d)} %`, good: d >= 0 };
}

const readLs = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === "object" ? { ...fallback, ...v } : v ?? fallback; } catch { return fallback; }
};
const writeLs = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento: no pasa nada */ } };

/** La etiqueta de un punto de la serie, en el idioma elegido. */
function bucketLabel(point, grain, lang, t) {
  const locale = lang === "en" ? "en-US" : "es";
  const bucket = point.bucket;
  if (grain === "hour") return new Date(2000, 0, 1, Number(bucket)).toLocaleTimeString(locale, { hour: "numeric" });
  if (grain === "year") return bucket;
  if (grain === "month") return new Date(`${bucket}-15T12:00:00`).toLocaleDateString(locale, { month: "short", year: "2-digit" });
  if (grain === "week") {
    const n = Number(bucket.split("-W")[1]);
    const d = point.start ? new Date(`${point.start}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" }) : bucket;
    return t("adm.sb.week", { n, d });
  }
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

/** Una ficha de la tira de totales: etiqueta, cifra y variación frente al periodo anterior. */
function Tile({ label, value, d, sub, neg, onClick }) {
  const click = typeof onClick === "function";
  return (
    <div className={`sb-tile ${click ? "click" : ""}`} role={click ? "button" : undefined} tabIndex={click ? 0 : undefined} onClick={onClick} onKeyDown={click ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}>
      <small>{label}</small>
      <b className={neg ? "neg" : ""}>{value}</b>
      {d ? <i className={d.good ? "good" : "bad"}>{d.text}{sub ? ` · ${sub}` : ""}</i> : sub ? <i>{sub}</i> : null}
    </div>
  );
}

/** Acordeón con el total en la cabecera, legible aunque esté cerrado. */
function Section({ id, icon, title, count, sum, open, onToggle, children, right }) {
  return (
    <details className="sb-acc" open={open} onToggle={(e) => onToggle(id, e.currentTarget.open)} data-sb-section={id}>
      <summary>
        <Icon name={icon} size={15} />
        <span>{title}</span>
        {count && <span className="sb-acc-n">{count}</span>}
        {right}
        {sum && <b className="sb-acc-sum">{sum}</b>}
        <Icon name="chevronDown" size={14} className="sb-acc-arrow" />
      </summary>
      <div className="sb-acc-body">{children}</div>
    </details>
  );
}

/** Tabla densa de una dimensión: nombre, ventas, (ganancia/comisión), (margen), nº, unidades, peso; totales al pie. */
function DimTable({ by, rows, totals, label, m, t, second, showMargin, canDrill, onDrill, focusKey, colorOf, inCompare, expanded, onExpand }) {
  const visible = expanded ? rows : rows.slice(0, ROWS_PREVIEW);
  const dimLabel = t(`adm.board.by.${by}`);
  const H = {
    total: t("adm.board.kpi.total"), second: second ? t(`adm.ins.metric.${second}`) : "", margin: t("adm.ins.margin"),
    count: t("adm.board.kpi.count"), units: t("adm.board.units"), share: t("adm.board.share"),
  };
  if (!rows.length) return <div className="adm-nodata">{t("adm.chart.noData")}</div>;
  return (
    <>
      <table className="adm-table responsive sb-table">
        <thead>
          <tr>
            <th>{dimLabel}</th><th className="r">{H.total}</th>
            {second && <th className="r">{H.second}</th>}
            {showMargin && <th className="r">{H.margin}</th>}
            <th className="r">{H.count}</th><th className="r">{H.units}</th><th className="r">{H.share}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const drill = canDrill(by, r);
            const focused = focusKey !== undefined && focusKey === r.key;
            return (
              <tr key={r.key ?? "none"} className={`${drill ? "drill" : ""} ${focused ? "on" : ""}`} onClick={drill ? () => onDrill(by, r) : undefined} title={drill ? t("adm.ins.drill") : undefined}>
                <td data-label={dimLabel} className="name">
                  {inCompare?.has(r.key) && <i className="sb-dot" style={{ background: colorOf(by, r.key, r.color) }} />}
                  <b>{label(by, r)}</b>
                  {drill && <Icon name="chevronRight" size={13} className="sb-go" />}
                </td>
                <td data-label={H.total} className="r">{m(r.sales)}</td>
                {second && <td data-label={H.second} className={`r ${r[second] < 0 ? "neg" : ""}`}>{m(r[second])}</td>}
                {showMargin && <td data-label={H.margin} className="r">{r.margin_pct === null ? "—" : `${r.margin_pct} %`}</td>}
                <td data-label={H.count} className="r">{r.count}</td>
                <td data-label={H.units} className="r">{r.units}</td>
                <td data-label={H.share} className="r">{r.share} %<span className="sb-share"><i style={{ width: `${Math.min(100, r.share)}%` }} /></span></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td data-label={dimLabel}>{t("adm.sb.total")}</td>
            <td data-label={H.total} className="r">{m(totals.sales)}</td>
            {second && <td data-label={H.second} className={`r ${totals[second] < 0 ? "neg" : ""}`}>{m(totals[second])}</td>}
            {showMargin && <td data-label={H.margin} className="r">{totals.margin_pct === null ? "—" : `${totals.margin_pct} %`}</td>}
            <td data-label={H.count} className="r">{totals.count}</td>
            <td data-label={H.units} className="r">{totals.units}</td>
            <td data-label={H.share} className="r">100 %</td>
          </tr>
        </tfoot>
      </table>
      {rows.length > ROWS_PREVIEW && <button type="button" className="btn-xs adm-noprint" onClick={() => onExpand(by, !expanded)}>{expanded ? t("adm.sb.showLess") : t("adm.sb.showAll", { n: rows.length })}</button>}
    </>
  );
}

/** Props: `go`/`tabs` (navegación) y `me` (GET /admin/team/me) para el filtro de tienda global; sin él se deduce del contexto del POS. */
export default function SalesBoard({ go, tabs = [], me }) {
  const { t, lang } = useLang();
  const { DESIGNS, MATERIALS, PHOTO, AR } = useLensCatalog();
  const [ctx, setCtx] = useState(null);
  const [period, setPeriod] = useState("month");
  const [f, setF] = useState({ ...periodRange("month"), payment_methods: [], categories: [], rx: "" });
  const [grain, setGrain] = useState(null); // null = la que convenga al periodo
  const [focus, setFocus] = useState([]); // [{ by, key, label }]
  const [compareOn, setCompareOn] = useState(() => readLs(LS_COMPARE, false) === true);
  const [compareBy, setCompareBy] = useState("establishment");
  const [metric, setMetric] = useState("sales");
  const [ins, setIns] = useState(null);
  const [summary, setSummary] = useState(null);
  const [state, setState] = useState("loading");
  const [open, setOpen] = useState(() => readLs(LS_OPEN, DEFAULT_OPEN));
  const [tab, setTab] = useState({ product: "product", lens: "lens_design", payment: "payment_method" });
  const [expanded, setExpanded] = useState({});
  const [moreFilters, setMoreFilters] = useState(false);
  const [sales, setSales] = useState([]);
  const [sellerOptions, setSellerOptions] = useState(new Map());
  // El color sigue a la entidad: quien tuvo un color lo conserva al filtrar.
  const colors = useRef(new Map());
  const bodyRef = useRef(null);
  const barRef = useRef(null);

  useEffect(() => { posContext().then(setCtx).catch(() => setCtx({ stores: [], payment_methods: [] })); }, []);
  // La barra se pega justo debajo de la cabecera del panel, mida lo que mida (en el móvil crece).
  useEffect(() => {
    const top = document.querySelector(".adm-top");
    if (!top || !barRef.current) return undefined;
    const apply = () => barRef.current?.style.setProperty("--sb-top", `${top.offsetHeight}px`);
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(top);
    return () => ro?.disconnect();
  }, []);
  useEffect(() => { writeLs(LS_OPEN, open); }, [open]);
  useEffect(() => { writeLs(LS_COMPARE, compareOn); }, [compareOn]);

  const focusOf = (by) => focus.find((x) => x.by === by);
  const filters = useMemo(() => {
    const extra = {};
    for (const x of focus) {
      if (x.by === "product" && x.key === "own_frame") extra.categories = ["own_frame"];
      else extra[FOCUS_PARAM[x.by]] = [x.key];
    }
    return { ...f, ...extra };
  }, [f, focus]);
  const query = useMemo(() => qs(filters), [filters]);

  const access = ins?.access;
  const isSeller = access?.role === "seller";
  const moreStores = (ctx?.stores?.length || 0) > 1 || ctx?.is_admin;
  // El vendedor ve sus propias ventas: agrupar por vendedor, o por su única tienda, no le dice nada.
  const dims = useMemo(() => ALL_DIMS.filter((d) => !isSeller || (d !== "seller" && (d !== "establishment" || moreStores))), [isSeller, moreStores]);
  const mainBy = dims.includes(compareBy) ? compareBy : "product";
  const bys = useMemo(() => [mainBy, ...dims.filter((d) => d !== mainBy)].join(","), [mainBy, dims]);

  useEffect(() => {
    let on = true;
    setState("loading");
    Promise.all([
      adminFetch(`/admin/sales-analytics/insights?${query}&${qs({ grain, by: bys })}`),
      adminFetch(`/admin/sales-analytics/summary?${query}`),
    ])
      .then(([a, b]) => { if (on) { setIns(a); setSummary(b); setState("ok"); } })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [query, grain, bys]);
  useEffect(() => {
    if (!open.sales) return undefined;
    let on = true;
    adminFetch(`/admin/sales-analytics/sales?${query}`).then((r) => on && setSales(r.sales || [])).catch(() => on && setSales([]));
    return () => { on = false; };
  }, [open.sales, query]);
  // Los vendedores del desplegable salen de la propia respuesta; se acumulan para que al filtrar uno no desaparezcan los demás.
  useEffect(() => {
    const rows = ins?.breakdowns?.seller?.rows;
    if (!rows) return;
    setSellerOptions((prev) => {
      const next = new Map(prev);
      for (const r of rows) if (r.key) next.set(r.key, r.label || r.key);
      return next;
    });
  }, [ins]);

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
  const label = (by, r) => {
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
  const colorOf = (by, key, own) => {
    if (own) return own;
    if (key === "web") return COLOR_WEB;
    const id = `${by}:${key}`;
    if (!colors.current.has(id)) colors.current.set(id, SERIES_COLORS[[...colors.current.keys()].filter((k) => k.startsWith(`${by}:`)).length % SERIES_COLORS.length]);
    return colors.current.get(id);
  };

  const pickPeriod = (p) => {
    setPeriod(p);
    setGrain(null);
    if (p !== "range") setF((x) => ({ ...x, ...periodRange(p) }));
  };
  const setDate = (k, v) => {
    if (!v) return;
    setGrain(null);
    setPeriod("range");
    setF((x) => ({ ...x, [k]: v, ...(k === "from" && v > x.to ? { to: v } : {}), ...(k === "to" && v < x.from ? { from: v } : {}) }));
  };
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const setOpenOne = useCallback((id, v) => setOpen((o) => (o[id] === v ? o : { ...o, [id]: v })), []);
  const setFocusOne = (by, key, lbl) => setFocus((x) => (key === null || key === undefined || key === "" ? x.filter((y) => y.by !== by) : [...x.filter((y) => y.by !== by), { by, key, label: lbl }]));
  const canDrill = (by, r) => r.key !== null && r.key !== undefined && Boolean(FOCUS_PARAM[by]) && focusOf(by)?.key !== r.key;
  const drill = (by, r) => {
    if (!canDrill(by, r)) return;
    setFocusOne(by, r.key, label(by, r));
    let next = NEXT_SECTION[by];
    if (next === "seller" && isSeller) next = "product";
    if (next) setOpenOne(next, true);
  };

  const storeFocus = focusOf("establishment");
  const sellerFocus = focusOf("seller");
  // El filtro global del panel fija el foco de tienda (la online es «web» para la analítica); con
  // «Todas», el tablero sigue pudiendo bajar a una tienda desde su propia tabla.
  const who = me || (ctx ? { is_admin: ctx.is_admin, role: ctx.role } : undefined);
  const { storeId: globalStore, isAll: globalAll } = useStoreFilter(who);
  useEffect(() => {
    if (globalAll) setFocusOne("establishment", null);
    else setFocusOne("establishment", globalStore, storeLabel(globalStore));
  }, [globalStore, globalAll, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const storeSlug = () => (storeFocus ? String(storeLabel(storeFocus.key)).replace(/[^\w-]+/g, "_") : "todas");

  const exportCsv = async () => {
    const s = getSession();
    const res = await fetch(`${ADMIN_API_URL}/admin/sales-analytics/export?${query}`, { headers: { Authorization: `Bearer ${s?.token}` } });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ventas_${storeSlug()}_${f.from}_${f.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const cur = ins?.totals;
  const prev = ins?.previous;
  const usedGrain = ins?.grain;
  const series = ins?.series || [];
  const labels = series.map((p) => bucketLabel(p, usedGrain, lang, t));
  const trendSeries = [
    { key: "sales", label: t("adm.board.kpi.total"), color: COLOR_SALES, values: series.map((p) => p.sales) },
    ...(second ? [{ key: second, label: t(`adm.ins.metric.${second}`), color: COLOR_SECOND, values: series.map((p) => p[second]) }] : []),
  ];
  const breakdowns = ins?.breakdowns || {};
  const rowsOf = (by) => [...(breakdowns[by]?.rows || [])].sort((a, b) => b[shownMetric] - a[shownMetric]);
  const compare = (breakdowns[mainBy]?.compare || []).map((c) => ({ key: c.key, label: label(mainBy, { key: c.key, label: c.label }), color: colorOf(mainBy, c.key, c.color), values: c[shownMetric] }));
  const inCompare = compareOn ? new Set(compare.map((c) => c.key)) : null;
  const bestBucket = series.reduce((best, p) => (p.sales > (best?.sales ?? 0) ? p : best), null);
  const useful = {
    hour: true,
    day: f.from !== f.to,
    week: isoWeekOf(f.from) !== isoWeekOf(f.to),
    month: f.from.slice(0, 7) !== f.to.slice(0, 7),
    year: f.from.slice(0, 4) !== f.to.slice(0, 4),
  };
  const otherFocus = focus.filter((x) => x.by !== "establishment" && x.by !== "seller");
  const sectionTotal = (by) => (breakdowns[by] ? `${t("adm.sb.count", { n: cur?.count ?? 0 })}` : "");
  const printMeta = () => t("adm.sb.printMeta", { store: storeFocus ? storeFocus.label : t("adm.sb.allStores"), seller: sellerFocus ? sellerFocus.label : t("adm.sb.allSellers"), from: f.from, to: f.to });
  // Para el PDF se abre todo en el DOM (un <details> cerrado se clona sin cuerpo) y se cierra
  // de nuevo nada más clonar; el estado de React no cambia. Las ventas sueltas solo si ya se cargaron.
  const beforePrint = () => {
    const closed = [...(bodyRef.current?.querySelectorAll("details.sb-acc") || [])].filter((d) => !d.open && d.dataset.sbSection !== "sales");
    closed.forEach((d) => { d.open = true; });
    return () => closed.forEach((d) => { d.open = false; });
  };

  // Excel: Resumen + Serie + una hoja por dimensión cargada, con sus totales.
  const xlsx = () => {
    if (!cur) return null;
    const kpi = (lbl, v, p) => ({ label: lbl, value: v, prev: p });
    const summaryRows = [
      kpi(t("adm.board.kpi.total"), cur.sales, prev.sales),
      kpi(t("adm.board.kpi.count"), cur.count, prev.count),
      kpi(t("adm.sb.kpi.units"), cur.units, prev.units),
      kpi(t("adm.board.kpi.avg"), cur.avg_ticket, prev.avg_ticket),
      ...(summary ? [kpi(t("adm.board.kpi.discount"), summary.current.discount, summary.previous?.discount)] : []),
      ...(access?.profit ? [kpi(t("adm.sb.kpi.cost"), cur.cost, prev.cost), kpi(t("adm.ins.part.fee"), cur.fee, prev.fee)] : []),
      ...(access?.commission ? [kpi(t("adm.sb.kpi.commission"), cur.commission, prev.commission)] : []),
      ...(access?.profit ? [kpi(t("adm.sb.kpi.profit"), cur.profit, prev.profit), kpi(`${t("adm.sb.kpi.margin")} %`, cur.margin_pct, prev.margin_pct)] : []),
    ];
    const numCols = (withMargin) => [
      { header: t("adm.board.kpi.total"), key: "sales", type: "money", width: 14 },
      ...(second ? [{ header: t(`adm.ins.metric.${second}`), key: second, type: "money", width: 14 }] : []),
      ...(withMargin && access?.profit ? [{ header: t("adm.ins.margin"), key: "margin_pct", type: "pct", width: 10 }] : []),
      { header: t("adm.board.kpi.count"), key: "count", type: "int", width: 11 },
      { header: t("adm.board.units"), key: "units", type: "int", width: 11 },
    ];
    const sheets = [
      {
        name: t("adm.sb.sheet.summary"),
        cols: [{ header: t("adm.sb.metricCol"), key: "label", width: 28 }, { header: t("adm.sb.valueCol"), key: "value", type: "number", width: 16 }, { header: t("adm.sb.prev"), key: "prev", type: "number", width: 16 }],
        rows: [{ label: t("adm.ins.period"), value: `${f.from} → ${f.to}`, prev: ins.previous_range ? `${ins.previous_range.from} → ${ins.previous_range.to}` : "" }, { label: t("adm.sb.store"), value: storeFocus ? storeFocus.label : t("adm.sb.allStores") }, { label: t("adm.sb.seller"), value: sellerFocus ? sellerFocus.label : t("adm.sb.allSellers") }, ...summaryRows],
      },
      {
        name: t("adm.sb.sheet.series"),
        cols: [{ header: t("adm.ins.period"), key: "label", width: 18 }, ...(usedGrain === "week" ? [{ header: t("adm.sb.weekStart"), key: "start", type: "date", width: 12 }] : []), ...numCols(false)],
        rows: series.map((p, i) => ({ ...p, label: labels[i] })),
        totals: { sales: cur.sales, [second || "_"]: second ? cur[second] : undefined, count: cur.count, units: cur.units },
        totalsLabel: t("adm.sb.total"),
      },
      ...dims.filter((by) => breakdowns[by]).map((by) => ({
        name: t(`adm.board.by.${by}`),
        cols: [{ header: t(`adm.board.by.${by}`), get: (r) => label(by, r), width: 34 }, ...numCols(true), { header: t("adm.board.share"), key: "share", type: "pct", width: 9 }],
        rows: rowsOf(by),
        totals: { sales: cur.sales, [second || "_"]: second ? cur[second] : undefined, margin_pct: cur.margin_pct, count: cur.count, units: cur.units, share: 100 },
        totalsLabel: t("adm.sb.total"),
      })),
    ];
    return { filename: `ventas_${storeSlug()}_${f.from}_${f.to}.xlsx`, sheets };
  };

  const tiles = cur && (
    <div className="sb-totals">
      <Tile label={t("adm.board.kpi.total")} value={m(cur.sales)} d={delta(cur.sales, prev.sales)} />
      <Tile label={t("adm.board.kpi.count")} value={String(cur.count)} d={delta(cur.count, prev.count)} onClick={() => setOpenOne("sales", true)} />
      <Tile label={t("adm.sb.kpi.units")} value={String(cur.units)} d={delta(cur.units, prev.units)} />
      <Tile label={t("adm.board.kpi.avg")} value={m(cur.avg_ticket)} d={delta(cur.avg_ticket, prev.avg_ticket)} />
      {summary && <Tile label={t("adm.board.kpi.discount")} value={m(summary.current.discount)} />}
      {access?.profit && <Tile label={t("adm.sb.kpi.cost")} value={m(cur.cost)} d={delta(cur.cost, prev.cost)} />}
      {access?.commission && <Tile label={isSeller ? t("adm.ins.metric.commission") : t("adm.sb.kpi.commission")} value={m(cur.commission)} d={delta(cur.commission, prev.commission)} />}
      {access?.profit && <Tile label={t("adm.sb.kpi.profit")} value={m(cur.profit)} d={delta(cur.profit, prev.profit)} neg={cur.profit < 0} />}
      {access?.profit && <Tile label={t("adm.sb.kpi.margin")} value={cur.margin_pct === null ? "—" : `${cur.margin_pct} %`} sub={prev.margin_pct !== null && prev.margin_pct !== undefined ? t("adm.board.vsPrev", { v: `${prev.margin_pct} %` }) : ""} />}
      {summary && <Tile label={t("adm.board.kpi.balance")} value={m(summary.balance_due)} sub={t("adm.board.kpi.balanceHint")} />}
      {summary && !isSeller && <Tile label={t("adm.board.kpi.insurance")} value={m(summary.insurance_due)} />}
    </div>
  );

  const tableProps = { totals: cur || {}, label, m, t, second, showMargin: Boolean(access?.profit), canDrill, onDrill: drill, colorOf, inCompare, onExpand: (by, v) => setExpanded((x) => ({ ...x, [by]: v })) };
  const dimTable = (by) => <DimTable key={by} by={by} rows={rowsOf(by)} focusKey={focusOf(by)?.key} expanded={Boolean(expanded[by])} {...tableProps} inCompare={by === mainBy ? inCompare : null} />;
  const tabbed = (sec) => {
    const visibleDims = sec.dims.filter((d) => dims.includes(d));
    const current = visibleDims.includes(tab[sec.key]) ? tab[sec.key] : visibleDims[0];
    return (
      <>
        {visibleDims.length > 1 && <SubTabs items={visibleDims.map((d) => ({ key: d, label: t(`adm.board.by.${d}`) }))} value={current} onChange={(d) => setTab((x) => ({ ...x, [sec.key]: d }))} />}
        {dimTable(current)}
      </>
    );
  };
  // Dentro de un <summary>: el clic no debe abrir ni cerrar el acordeón.
  const metricSwitch = second && (
    <span className="adm-range adm-noprint" role="group" aria-label={t("adm.ins.metric")} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <button type="button" className={shownMetric === "sales" ? "on" : ""} onClick={() => setMetric("sales")}>{t("adm.board.kpi.total")}</button>
      <button type="button" className={shownMetric === second ? "on" : ""} onClick={() => setMetric("second")}>{t(`adm.ins.metric.${second}`)}</button>
    </span>
  );

  return (
    <div className="adm-section pos sb-root">
      <div className="sb-head">
        <h2>{t("adm.tab.salesboard")}<HelpTip topic="salesboard.what" size={16} /></h2>
        <p>{t(isSeller ? "adm.ins.subSeller" : "adm.ins.sub")}</p>
      </div>

      <div className={`sb-bar adm-noprint ${state === "loading" ? "busy" : ""}`} ref={barRef}>
        <div className="sb-chips" role="group" aria-label={t("adm.ins.period")}>
          {PERIODS.map((p) => <button key={p} type="button" className={period === p ? "on" : ""} onClick={() => pickPeriod(p)}>{t(p === "range" || p === "week" || p === "lastWeek" ? `adm.sb.preset.${p}` : `adm.board.preset.${p}`)}</button>)}
        </div>
        <span className="sb-dates">
          <input type="date" value={f.from} max={f.to} aria-label={t("adm.board.from")} title={t("adm.board.from")} onChange={(e) => setDate("from", e.target.value)} />
          –
          <input type="date" value={f.to} min={f.from} aria-label={t("adm.board.to")} title={t("adm.board.to")} onChange={(e) => setDate("to", e.target.value)} />
        </span>
        <div className="adm-range" role="group" aria-label={t("adm.ins.seeBy")}>
          {GRAINS.map((g) => <button key={g} type="button" className={usedGrain === g ? "on" : ""} disabled={!useful[g]} title={useful[g] ? undefined : t("adm.ins.grainNotUseful")} onClick={() => setGrain(g)}>{t(`adm.ins.grain.${g}`)}</button>)}
        </div>
        <HelpTip topic="salesboard.grain" />
        {moreStores && who && <StoreFilter me={who} />}
        {moreStores && globalAll && storeFocus && (
          <button type="button" className="adm-chip neutral" onClick={() => setFocusOne("establishment", null)} aria-label={t("adm.ins.removeFocus", { label: storeFocus.label })} title={t("adm.ins.removeFocus", { label: storeFocus.label })}>
            {t("adm.board.by.establishment")}: {storeFocus.label} <Icon name="close" size={11} />
          </button>
        )}
        {!isSeller && (
          <select value={sellerFocus?.key ?? ""} aria-label={t("adm.sb.seller")} title={t("adm.sb.seller")} onChange={(e) => setFocusOne("seller", e.target.value, e.target.value ? `${sellerOptions.get(e.target.value) || e.target.value} (${e.target.value})` : "")}>
            <option value="">{t("adm.sb.allSellers")}</option>
            {[...sellerOptions.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => <option key={code} value={code}>{name === code ? code : `${name} (${code})`}</option>)}
            {sellerFocus && !sellerOptions.has(sellerFocus.key) && <option value={sellerFocus.key}>{sellerFocus.label}</option>}
          </select>
        )}
        <label className="sb-toggle" title={t("adm.sb.compareHint")}>
          <input type="checkbox" checked={compareOn} onChange={(e) => setCompareOn(e.target.checked)} />{t("adm.sb.compare")}
        </label>
        <button type="button" className={`btn-xs ${moreFilters || f.payment_methods.length || f.categories.length || f.rx ? "primary" : ""}`} onClick={() => setMoreFilters((v) => !v)} aria-expanded={moreFilters}><Icon name="filter" size={13} /> {t("adm.sb.moreFilters")}</button>
        {(otherFocus.length > 0 || focus.length > 0) && (
          <span className="sb-focus">
            {otherFocus.map((x) => (
              <button key={x.by} type="button" className="adm-chip neutral" onClick={() => setFocusOne(x.by, null)} aria-label={t("adm.ins.removeFocus", { label: x.label })} title={t("adm.ins.removeFocus", { label: x.label })}>
                {t(`adm.board.by.${x.by}`)}: {x.label} <Icon name="close" size={11} />
              </button>
            ))}
            <button type="button" className="btn-xs" onClick={() => setFocus([])}>{t("adm.ins.clearFocus")}</button>
          </span>
        )}
        <span className="sb-export">
          <ExportMenu targetRef={bodyRef} title={`${t("adm.tab.salesboard")} · ${f.from} – ${f.to}`} name="ventas" compact={false} xlsx={xlsx} onCsv={exportCsv} meta={printMeta} beforePrint={beforePrint} />
        </span>
        {moreFilters && (
          <div className="sb-more">
            <span className="sb-chips"><b>{t("adm.board.payment")}</b>
              {(ctx?.payment_methods || []).map((pm) => <button key={pm.code} type="button" className={f.payment_methods.includes(pm.code) ? "on" : ""} onClick={() => toggle("payment_methods", pm.code)}>{methodName(pm, t, lang)}</button>)}
            </span>
            <span className="sb-chips"><b>{t("adm.board.category")}</b>
              {["frame", "case", "own_frame"].map((c) => <button key={c} type="button" className={f.categories.includes(c) ? "on" : ""} onClick={() => toggle("categories", c)}>{t(`adm.board.cat.${c}`)}</button>)}
            </span>
            <span className="sb-chips"><b>{t("adm.board.rx")}</b>
              <select value={f.rx} aria-label={t("adm.board.rx")} onChange={(e) => setF((x) => ({ ...x, rx: e.target.value }))}>
                <option value="">{t("adm.board.any")}</option><option value="1">{t("adm.board.withRx")}</option><option value="0">{t("adm.board.withoutRx")}</option>
              </select>
            </span>
          </div>
        )}
      </div>

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
        <div className={`ins-body ${state === "loading" ? "busy" : ""}`} aria-busy={state === "loading"} ref={bodyRef}>
          {tiles}

          {cur.count > 0 && bestBucket && (
            <ul className="sb-notes">
              <li><Icon name="sparkles" size={14} /> {t(`adm.ins.best.${usedGrain}`, { label: bucketLabel(bestBucket, usedGrain, lang, t), v: m(bestBucket.sales) })}</li>
            </ul>
          )}

          <div className="sb-accs">
            <Section id="series" icon="trendUp" title={t(`adm.ins.trend.${second || "sales"}.${usedGrain}`)} count={t("adm.sb.buckets", { n: series.length })} sum={m(cur.sales)} open={Boolean(open.series)} onToggle={setOpenOne} right={metricSwitch}>
              {usedGrain === "hour" && <p className="adm-sub">{t("adm.ins.hourHint")}</p>}
              <div className="sb-two">
                <div>
                  <TrendChart labels={labels} series={trendSeries} format={m} axisFormat={compactMoney} height={230} tipExtra={(i) => [t("adm.ins.tipCount", { n: series[i].count, units: series[i].units })]} />
                  {compareOn && compare.length > 1 && series.length > 1 && (
                    <>
                      <div className="sb-acc-tools">
                        <span>{t("adm.sb.compareBy")}</span>
                        <select value={mainBy} aria-label={t("adm.sb.compareBy")} onChange={(e) => setCompareBy(e.target.value)}>
                          {dims.map((d) => <option key={d} value={d}>{t(`adm.board.by.${d}`)}</option>)}
                        </select>
                        <span>{t("adm.ins.compare", { n: compare.length })}</span>
                      </div>
                      <TrendChart labels={labels} series={compare} format={m} axisFormat={compactMoney} forceLines height={220} />
                    </>
                  )}
                </div>
                <div className="sb-scroll">
                  <table className="adm-table sb-table">
                    <thead><tr><th>{t("adm.ins.period")}</th><th className="r">{t("adm.board.kpi.total")}</th>{second && <th className="r">{t(`adm.ins.metric.${second}`)}</th>}<th className="r">{t("adm.board.kpi.count")}</th><th className="r">{t("adm.board.units")}</th></tr></thead>
                    <tbody>
                      {series.map((p, i) => (
                        <tr key={p.bucket}>
                          <td title={usedGrain === "week" ? t("adm.sb.weekLong", { n: Number(p.bucket.split("-W")[1]), d: p.start }) : undefined}>{labels[i]}</td>
                          <td className="r">{m(p.sales)}</td>
                          {second && <td className={`r ${p[second] < 0 ? "neg" : ""}`}>{m(p[second])}</td>}
                          <td className="r">{p.count}</td><td className="r">{p.units}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>{t("adm.sb.total")}</td><td className="r">{m(cur.sales)}</td>{second && <td className="r">{m(cur[second])}</td>}<td className="r">{cur.count}</td><td className="r">{cur.units}</td></tr></tfoot>
                  </table>
                </div>
              </div>
            </Section>

            {SECTIONS.filter((sec) => sec.dims.some((d) => dims.includes(d))).map((sec) => (
              <Section key={sec.key} id={sec.key} icon={sec.icon} title={t(`adm.sb.sec.${sec.key}`)} count={sectionTotal(sec.dims[0])} sum={m(cur[shownMetric])} open={Boolean(open[sec.key])} onToggle={setOpenOne}>
                {tabbed(sec)}
              </Section>
            ))}

            {access?.profit && (
              <Section id="split" icon="wallet" title={t("adm.ins.split")} count={t("adm.ins.marginOf", { pct: cur.margin_pct ?? 0 })} sum={m(cur.profit)} open={Boolean(open.split)} onToggle={setOpenOne}>
                <p className="adm-sub">{t("adm.ins.profitHint")}</p>
                <MoneySplit totals={cur} m={m} t={t} />
              </Section>
            )}

            <Section id="sales" icon="receipt" title={focus.length ? t("adm.board.salesOf", { label: focus.map((x) => x.label).join(" · ") }) : t("adm.sb.sec.sales")} count={t("adm.sb.count", { n: cur.count })} sum={m(cur.sales)} open={Boolean(open.sales)} onToggle={setOpenOne}>
              <table className="adm-table responsive sb-table">
                <thead><tr><th>{t("adm.pos.sales.number")}</th><th>{t("adm.pos.sales.when")}</th><th>{t("adm.pos.store")}</th><th>{t("adm.pos.sales.seller")}</th><th>{t("adm.board.items")}</th><th className="r">{t("adm.board.kpi.total")}</th></tr></thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.order_id}>
                      <td data-label={t("adm.pos.sales.number")}><b>{s.number || t("adm.board.web")}</b></td>
                      <td data-label={t("adm.pos.sales.when")}>{new Date(s.sold_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td data-label={t("adm.pos.store")}>{s.channel === "web" ? t("adm.board.web") : storeLabel(s.establishment_id)}</td>
                      <td data-label={t("adm.pos.sales.seller")}>{s.seller_code || "—"}</td>
                      <td data-label={t("adm.board.items")} className="name"><small>{s.items.replace(/own_frame/g, t("adm.pos.own.tag"))}</small></td>
                      <td data-label={t("adm.board.kpi.total")} className="r">{m(s.total)}</td>
                    </tr>
                  ))}
                  {sales.length === 0 && <tr><td colSpan="6" className="full"><div className="adm-nodata">{t("adm.chart.noData")}</div></td></tr>}
                </tbody>
                {sales.length > 0 && <tfoot><tr><td data-label={t("adm.pos.sales.number")} colSpan="5">{t("adm.sb.total")}</td><td data-label={t("adm.board.kpi.total")} className="r">{m(sales.reduce((s, x) => s + Number(x.total || 0), 0))}</td></tr></tfoot>}
              </table>
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
