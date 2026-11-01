// Panel del vendedor. Dónde se usa: Ejecutivo › Vendedores (fila), Vendedores
// (ranking), Pedidos web › Ventas por vendedor y, por `onSeller`, Costos y
// margen. Al pulsar un vendedor se abre DELANTE de la pantalla, difuminando el
// fondo (misma capa que el mapa de inicio: portal en `.adm-main`, la barra
// lateral sigue usable), el resumen de inicio de ESA persona:
//
//   cabecera   avatar · nombre · código · tienda (punto de color) · comisión %
//   período    los mismos presets del Ejecutivo (hoy/ayer/semana/mes/rango…),
//              heredados de la pantalla que lo abre y SIEMPRE aplicados;
//   teselas    ventas · nº · ticket medio · ganancia que me genera (quien ve
//              costos) · ganancia promedio por venta · comisión a pagar · cuota
//              (su parte de las ventas de la tienda, con ayuda) · en laboratorio
//              · por entregar · dinero en la calle de sus ventas;
//   canales    iconos de la red por la que vendió (whatsapp/instagram/tiktok/
//              facebook/enlace) con nº y dinero;
//   últimas    sus últimas ventas (nº, fecha, cliente, total, pagado, saldo),
//              clicables si llega `openSale`;
//   pie        «Ver sus pedidos» (go("storeorders", { seller })) y «Cerrar»;
//              exportar PDF / Excel / CSV («Reporte de vendedor · nombre»).
//
// Lecturas: GET /admin/pos/start-map?seller=<código>&store= (ficha, pendientes,
// lib/start-map.ts), GET /admin/sales-analytics/insights (cifras del período,
// dos veces: las del vendedor y el total de la tienda para la cuota),
// GET /admin/sellers/stats (canales) y GET /admin/sales-analytics/sales
// (últimas ventas). Costo y ganancia solo llegan cuando el servidor lo permite
// (`access.profit`): aquí no se oculta nada que el servidor no haya mandado ya.
//
//   const sp = useSellerPanel({ go, openSale, me });
//   <tr onClick={() => sp.open(row.code, { from, to, store, period })}>…</tr>
//   {sp.panel}
//
//   <SellerChannels by_source={row.by_source} compact />   iconos + nº (importe al pasar)
//
// Helpers compartidos con el Ejecutivo, Vendedores y Pedidos web (una sola
// forma de fila): sellerRowsFromInsights, sellerRowsFromStats, sellerReportCols,
// sellersReportSpec.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import HelpTip from "./HelpTip.jsx";
import { adminFetch } from "./adminApi.js";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney, shortDate } from "./adminOrders.js";
import { ExportMenu } from "./ui.jsx";
import { SOURCE_ICON } from "./sellerShared.jsx";
import { PERIODS, pct, saleNumber } from "./StoreOrders.jsx";
import { periodRange } from "./SalesBoard.jsx";
import { defaultColorForStore } from "./useStoreTheme.js";
import "./seller-panel.css";

const int = (n, lang) => (Number(n) || 0).toLocaleString(lang === "en" ? "en-US" : "es-US");
const cents = (c) => (Number(c) || 0) / 100;
const initialsOf = (name) => String(name || "?").trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
/** "all" / "" / null → sin filtro; "web" o el id de una tienda → ese. */
const storeOf = (store) => (!store || store === "all" ? "" : store);
/** Las ventas pintadas en el panel; el reporte lleva la página entera. */
const LAST_SHOWN = 8;

/* ───────────────────────── Canales (redes) ───────────────────────── */

/**
 * Iconos de las redes por las que vendió, cada uno con el nº de ventas y, en
 * largo, el importe (en `compact` el importe va en el título). `by_source` es
 * la lista de GET /admin/sellers/stats ({ source, orders, revenue }).
 */
export function SellerChannels({ by_source = [], compact = false, max = 6, className = "" }) {
  const { t, lang } = useLang();
  const rows = (by_source || []).filter((s) => s && s.orders > 0).slice(0, max);
  if (!rows.length) return compact ? null : <p className="sp-channels-none">{t("adm.sp.channels.none")}</p>;
  const label = (k) => (t(`adm.src.${k}`) === `adm.src.${k}` ? k : t(`adm.src.${k}`));
  return (
    <span className={`sp-channels ${compact ? "compact" : ""} ${className}`.trim()}>
      {rows.map((s) => (
        <span key={s.source} className={`sp-channel ${compact ? "compact" : ""}`} title={t("adm.sp.channel.via", { n: s.orders, net: label(s.source), v: fmtMoney(s.revenue, "usd", lang) })}>
          <Icon name={SOURCE_ICON[s.source] || "link"} size={compact ? 11 : 13} />
          {int(s.orders, lang)}
          {!compact && <em>· {fmtMoney(s.revenue, "usd", lang)}</em>}
        </span>
      ))}
    </span>
  );
}

/* ───────────────────────── Filas compartidas ───────────────────────── */

const sortRows = (rows) => rows.sort((a, b) => b.sales - a.sales || b.count - a.count || String(a.name).localeCompare(String(b.name), "es"));

/**
 * Filas de la tabla de vendedores a partir de GET /admin/sales-analytics/insights
 * (`by=seller`): una por vendedor con ventas, ordenadas de mayor a menor; los
 * que no vendieron se cuentan en `zero` y no se listan; la fila «sin vendedor»
 * (key null) tampoco (no es una persona). `sellers` (GET /admin/sellers), si
 * llega, añade tienda y canales a cada fila.
 */
export function sellerRowsFromInsights(rows, { sellers = null, stats = null } = {}) {
  const byCode = new Map((sellers || []).map((s) => [String(s.code || "").toUpperCase(), s]));
  const statBy = new Map((stats || []).map((s) => [String(s.code || "").toUpperCase(), s]));
  const out = [];
  let zero = 0;
  for (const r of rows || []) {
    if (!r.key) continue;
    if (!(Number(r.sales) > 0) && !(Number(r.count) > 0)) { zero += 1; continue; }
    const code = String(r.key).toUpperCase();
    const seller = byCode.get(code);
    const count = Number(r.count) || 0;
    out.push({
      key: code,
      code,
      id: seller?.id ?? statBy.get(code)?.id ?? null,
      name: r.label || seller?.name || code,
      establishment_id: seller?.establishment_id ?? null,
      sales: Number(r.sales) || 0,
      count,
      units: Number(r.units) || 0,
      ticket: Number(r.avg_ticket) || (count ? (Number(r.sales) || 0) / count : 0),
      profit: r.profit == null ? null : Number(r.profit),
      margin_pct: r.margin_pct ?? null,
      avg_profit: r.profit == null ? null : count ? Number(r.profit) / count : 0,
      commission: r.commission == null ? null : Number(r.commission),
      share: Number(r.share) || 0,
      by_source: statBy.get(code)?.by_source || [],
    });
  }
  // Vendedores dados de alta que no aparecen en las cifras: tampoco vendieron.
  if (sellers) for (const s of sellers) if (s.active !== false && !out.some((r) => r.code === String(s.code || "").toUpperCase()) && !(rows || []).some((r) => r.key && String(r.key).toUpperCase() === String(s.code || "").toUpperCase())) zero += 1;
  return { rows: sortRows(out), zero };
}

/** Las mismas filas a partir de GET /admin/sellers/stats (`sellers[]`). */
export function sellerRowsFromStats(statRows, { sellers = null } = {}) {
  const byId = new Map((sellers || []).map((s) => [s.id, s]));
  const out = [];
  let zero = 0;
  for (const s of statRows || []) {
    if (!(s.orders > 0)) { zero += 1; continue; }
    out.push({
      key: s.code,
      code: s.code,
      id: s.id,
      name: s.name,
      establishment_id: byId.get(s.id)?.establishment_id ?? null,
      sales: Number(s.revenue) || 0,
      count: Number(s.orders) || 0,
      units: Number(s.units) || 0,
      ticket: Number(s.avg_ticket) || 0,
      profit: s.profit == null ? null : Number(s.profit),
      margin_pct: null,
      avg_profit: s.avg_profit == null ? null : Number(s.avg_profit),
      commission: Number(s.commission) || 0,
      share: Number(s.share_pct) || 0,
      by_source: s.by_source || [],
      commission_pct: s.commission_pct,
      last_order_at: s.last_order_at || null,
    });
  }
  return { rows: sortRows(out), zero };
}

/** Suma de filas (la fila en negrita del final). */
export function sellerRowsTotals(rows) {
  const t = { sales: 0, count: 0, units: 0, profit: 0, commission: 0, share: 0, hasProfit: false, hasCommission: false };
  for (const r of rows) {
    t.sales += r.sales; t.count += r.count; t.units += r.units; t.share += r.share;
    if (r.profit != null) { t.hasProfit = true; t.profit += r.profit; }
    if (r.commission != null) { t.hasCommission = true; t.commission += r.commission; }
  }
  t.ticket = t.count ? t.sales / t.count : 0;
  t.avg_profit = t.hasProfit && t.count ? t.profit / t.count : null;
  t.share = Math.round(t.share * 10) / 10;
  return t;
}

/** Columnas del reporte (ReportDoc.exportReport) y del Excel: las de la tabla del Ejecutivo. */
export function sellerReportCols({ t, showProfit, showCommission, withStore = false, withChannels = false, storeLabel = null }) {
  return [
    { header: t("adm.ex.sellers.name"), key: "name", width: 24 },
    { header: t("adm.sp.col.code"), key: "code", width: 9 },
    ...(withStore ? [{ header: t("adm.sp.col.store"), key: "establishment_id", width: 16, text: (r) => (typeof storeLabel === "function" ? storeLabel(r.establishment_id) : r.establishment_id || "") }] : []),
    { header: t("adm.ex.sellers.sales"), key: "sales", type: "money", width: 13 },
    { header: t("adm.ex.sellers.count"), key: "count", type: "int", width: 7 },
    { header: t("adm.ex.sellers.units"), key: "units", type: "int", width: 7 },
    { header: t("adm.sp.col.ticket"), key: "ticket", type: "money", width: 11 },
    ...(showProfit ? [
      { header: t("adm.ex.sellers.profit"), key: "profit", type: "money", width: 13, cls: (r) => (Number(r.profit) < 0 ? "neg" : "") },
      { header: t("adm.sp.col.avgProfit"), key: "avg_profit", type: "money", width: 13 },
    ] : []),
    ...(showCommission ? [{ header: t("adm.ex.sellers.commission"), key: "commission", type: "money", width: 12 }] : []),
    { header: t("adm.ex.sellers.share"), key: "share", type: "pct", width: 8, text: (r) => pct(r.share), totalText: (v) => pct(v) },
    ...(withChannels ? [{ header: t("adm.sp.col.channels"), key: "channels", width: 18, get: (r) => (r.by_source || []).filter((s) => s.orders > 0).map((s) => `${s.source} ${s.orders}`).join(" · ") }] : []),
  ].map((c) => ({ ...c, get: c.get || ((r) => r[c.key]) }));
}

/**
 * El reporte de vendedores (PDF apaisado / Excel / CSV): un bloque por tienda
 * con subtotales cuando `groups` llega (todas las tiendas), si no una tabla.
 * `groups`: [{ id, label, color?, rows }]. Los vendedores sin ventas no van:
 * se dicen en la nota.
 */
export function sellersReportSpec({ rows, groups = null, zero = 0, t, lang, title, store = null, scope, period, showProfit, showCommission, kpis = [], summaries = [], storeLabel = null }) {
  const withChannels = rows.some((r) => (r.by_source || []).some((x) => x.orders > 0));
  const cols = sellerReportCols({ t, showProfit, showCommission, withChannels });
  const totals = sellerRowsTotals(rows);
  const totalsOf = (tt) => ({ sales: tt.sales, count: tt.count, units: tt.units, ticket: tt.ticket, profit: showProfit ? tt.profit : undefined, avg_profit: showProfit ? tt.avg_profit : undefined, commission: showCommission ? tt.commission : undefined, share: tt.share });
  const note = zero ? t("adm.sp.rpt.zero", { n: zero }) : undefined;
  const m = (v) => fmtMoney(v, "usd", lang);
  // `key` nombra el concepto de cada tarjeta para que ReportDoc sepa qué puede
  // salir en la versión para compartir (nunca por el rótulo, que es traducible).
  const baseKpis = kpis.length ? kpis : [
    { key: "sales", label: t("adm.ex.sellers.sales"), value: m(totals.sales), raw: totals.sales, sub: t("adm.sp.k.sales.n", { n: int(totals.count, lang) }) },
    { key: "ticket", label: t("adm.sp.col.ticket"), value: m(totals.ticket), raw: totals.ticket },
    showProfit ? { key: "profit", label: t("adm.ex.sellers.profit"), value: m(totals.profit), raw: totals.profit, neg: totals.profit < 0 } : null,
    showProfit ? { key: "avg_profit", label: t("adm.sp.col.avgProfit"), value: m(totals.avg_profit || 0), raw: totals.avg_profit } : null,
    showCommission ? { key: "commission", label: t("adm.ex.sellers.commission"), value: m(totals.commission), raw: totals.commission } : null,
    { key: "count", label: t("adm.ex.sellers.name"), value: int(rows.length, lang), raw: rows.length, sub: note },
  ];
  const tables = groups && groups.length > 1
    ? [
      ...groups.map((g) => ({ title: t("adm.sp.rpt.storeBlock", { store: g.label }), cols, rows: g.rows, totals: totalsOf(sellerRowsTotals(g.rows)), totalsLabel: t("adm.sp.rpt.subtotal"), sheet: g.label.slice(0, 28) })),
      { title: t("adm.sp.rpt.total"), cols: sellerReportCols({ t, showProfit, showCommission, withStore: true, withChannels, storeLabel }), rows, totals: totalsOf(totals), totalsLabel: t("adm.sp.rpt.total"), note, main: true, sheet: t("adm.sp.rpt.sellersSheet") },
    ]
    : [{ title: t("adm.sp.rpt.sellersSheet"), cols, rows, totals: totalsOf(totals), totalsLabel: t("adm.sp.rpt.total"), note, main: true, empty: t("adm.ex.sellers.empty") }];
  return { title, store, scope: store ? undefined : scope, period, kpis: baseKpis, summaries, tables, landscape: true, lang, t, filename: `${t("adm.sp.rpt.sellersName")}-${store?.code || "all"}-${period?.from || ""}_${period?.to || ""}` };
}

/* ───────────────────────── Capa (portal en .adm-main) ───────────────────────── */

function useMainOffset() {
  const [left, setLeft] = useState(0);
  const [host, setHost] = useState(null);
  useEffect(() => {
    const main = typeof document !== "undefined" ? document.querySelector(".adm-main") : null;
    setHost(main || (typeof document !== "undefined" ? document.body : null));
    if (!main) return undefined;
    const measure = () => setLeft(Math.max(0, Math.round(main.getBoundingClientRect().left)));
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(main);
    window.addEventListener("resize", measure);
    const shell = main.closest(".adm-shell");
    shell?.addEventListener("transitionend", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); shell?.removeEventListener("transitionend", measure); };
  }, []);
  return { left, host };
}

const Skel = ({ w = "70%", sm = false }) => <span className={`adm-skel ${sm ? "sm" : ""}`} style={{ width: w }} aria-hidden="true" />;

/** Tesela: botón cuando lleva `onClick`, estática si no; `help` pone el «?» en la esquina (fuera del botón). */
function Tile({ label, value, sub, tone = "", loading = false, failed = false, onClick, title, help }) {
  const click = typeof onClick === "function";
  const body = (
    <>
      <small>{label}</small>
      {loading ? <Skel /> : <b>{failed ? "—" : value}</b>}
      {loading ? <Skel sm /> : <span>{sub}</span>}
      {click && <Icon name="chevronRight" size={14} className="chev" />}
    </>
  );
  if (click) return <button type="button" className={`sp-tile ${tone}`} onClick={onClick} title={title || undefined}>{body}</button>;
  return (
    <div className={`sp-tile static ${tone}`} title={title || undefined}>
      {body}
      {help && <HelpTip topic={help} size={12} className="sp-tile-help" />}
    </div>
  );
}

/* ───────────────────────── El panel ───────────────────────── */

/**
 * `seller`: código o id. `filters`: { from, to, store, period } de la pantalla
 * que lo abre (el período se hereda y se puede cambiar; siempre se aplica).
 */
export default function SellerPanel({ seller, filters = {}, onClose, go, openSale, me }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const { left, host } = useMainOffset();
  const cardRef = useRef(null);
  const store = storeOf(filters.store);

  // Período: el heredado (preset del Ejecutivo o rango a mano), cambiable aquí.
  const [period, setPeriod] = useState(() => (filters.period && PERIODS.includes(filters.period) ? filters.period : filters.from && filters.to ? "range" : "month"));
  const [range, setRange] = useState(() => (filters.from && filters.to ? { from: filters.from, to: filters.to } : periodRange(filters.period && filters.period !== "range" ? filters.period : "month")));
  const pick = (p) => { setPeriod(p); if (p !== "range") setRange(periodRange(p)); };
  const setDate = (k, v) => { if (!v) return; setPeriod("range"); setRange((r) => ({ ...r, [k]: v })); };
  const { from, to } = range;

  const [base, setBase] = useState(null);      // start-map?seller=
  const [baseErr, setBaseErr] = useState(null);
  const [fig, setFig] = useState(null);        // cifras del período
  const [figState, setFigState] = useState("loading");

  // Ficha y pendientes: una vez por vendedor y tienda (no dependen del período).
  useEffect(() => {
    if (demo) { setBaseErr("demo"); return undefined; }
    let on = true;
    setBase(null);
    setBaseErr(null);
    adminFetch("/admin/pos/start-map", { query: { seller, store } })
      .then((d) => { if (on) setBase(d); })
      .catch((e) => { if (on) setBaseErr(e?.reason || "error"); });
    return () => { on = false; };
  }, [seller, store, demo]);

  // El código manda en las lecturas del período: si llegó un id, se espera a la ficha.
  const code = base?.subject?.code || (!base && /^[A-Za-z0-9]{3,12}$/.test(String(seller || "")) ? String(seller).toUpperCase() : null);

  // Cifras del período: las del vendedor, el total de la tienda (cuota), canales y últimas ventas.
  useEffect(() => {
    if (demo || !code || from > to) return undefined;
    let on = true;
    setFigState("loading");
    const stores = store ? { stores: store } : {};
    Promise.all([
      adminFetch("/admin/sales-analytics/insights", { query: { from, to, by: "seller", seller_codes: code, ...stores } }),
      adminFetch("/admin/sales-analytics/insights", { query: { from, to, by: "establishment", ...stores } }).catch(() => null),
      adminFetch("/admin/sellers/stats", { query: { from, to, store } }).catch(() => null),
      adminFetch("/admin/sales-analytics/sales", { query: { from, to, seller_codes: code, page: 0, ...stores } }).catch(() => null),
    ])
      .then(([mine, all, stats, sales]) => {
        if (!on) return;
        const statRow = (stats?.sellers || []).find((s) => s.code === code || s.id === base?.subject?.id) || null;
        setFig({ mine, all, statRow, sales: sales?.sales || [], hasMore: Boolean(sales?.has_more), access: mine?.access || {} });
        setFigState("ok");
      })
      .catch(() => { if (on) setFigState("error"); });
    return () => { on = false; };
  }, [code, from, to, store, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Foco en la tarjeta; Escape cierra; el fondo no hace scroll.
  useEffect(() => { if (host) cardRef.current?.focus({ preventScroll: true }); }, [host]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const subject = base?.subject || null;
  const m = (v) => fmtMoney(v, "usd", lang);
  const tot = fig?.mine?.totals || null;
  const storeTot = fig?.all?.totals || null;
  const access = fig?.access || base?.access || {};
  const showProfit = access.profit === true;
  const showCommission = access.commission === true;
  const loading = figState === "loading" && !fig;
  const failed = figState === "error" || baseErr === "error";
  const pend = base?.pending || null;
  const count = Number(tot?.count) || 0;
  const avgProfit = tot && tot.profit != null && count ? tot.profit / count : null;
  const share = tot && storeTot && Number(storeTot.sales) > 0 ? Math.round((tot.sales / storeTot.sales) * 1000) / 10 : 0;
  const bySource = fig?.statRow?.by_source || subject?.by_source || [];
  const lastSales = fig?.sales || [];
  const color = subject ? subject.color || (subject.store_name ? defaultColorForStore(subject.store_name) : null) : null;
  const name = subject?.name || code || "";
  const storeText = subject?.store_code ? `${subject.store_code} · ${subject.store_name}` : t("adm.sp.noStore");

  const close = () => onClose?.();
  const jump = (tab, params) => { go?.(tab, params); close(); };
  const sellerParams = { seller: code, from, to, period };
  const toOrders = () => jump("storeorders", sellerParams);
  const toLab = (stage) => jump("storeorders", { ...sellerParams, stage });
  const toBalances = () => jump("pendingbalances", { seller: code });

  // Reporte: «Reporte de vendedor · nombre», apaisado, con las teselas, los canales y sus ventas del período.
  const report = () => {
    const k = (label, value, raw, extra = {}) => ({ label, value, raw, ...extra });
    const srcLabel = (s) => (t(`adm.src.${s}`) === `adm.src.${s}` ? s : t(`adm.src.${s}`));
    return {
      title: t("adm.sp.reportTitle", { name }),
      subtitle: [code, storeText, subject ? t("adm.sp.commissionPct", { pct: subject.commission_pct }) : ""].filter(Boolean).join(" · "),
      store: subject?.store_code ? { code: subject.store_code, name: subject.store_name, color } : null,
      scope: subject?.store_code ? undefined : t("adm.rpt.allStores"),
      period: { from, to },
      kpis: [
        k(t("adm.sp.k.sales"), m(tot?.sales || 0), tot?.sales || 0, { sub: t("adm.sp.k.sales.n", { n: int(count, lang) }) }),
        k(t("adm.sp.k.ticket"), m(tot?.avg_ticket || 0), tot?.avg_ticket || 0),
        k(t("adm.sp.k.units"), int(tot?.units || 0, lang), tot?.units || 0),
        showProfit ? k(t("adm.sp.k.profit"), m(tot?.profit || 0), tot?.profit || 0, { neg: Number(tot?.profit) < 0, sub: tot?.margin_pct != null ? t("adm.sp.k.margin", { pct: pct(tot.margin_pct) }) : undefined }) : null,
        showProfit ? k(t("adm.sp.k.avgProfit"), m(avgProfit || 0), avgProfit || 0) : null,
        showCommission ? k(t("adm.sp.k.commission"), m(tot?.commission || 0), tot?.commission || 0) : null,
        k(t("adm.sp.k.quota"), pct(share), share, { sub: storeTot ? t("adm.sp.k.ofStore", { v: m(storeTot.sales) }) : undefined }),
        pend ? k(t("adm.sp.k.inLab"), int(pend.in_lab.count, lang), pend.in_lab.count, { sub: t("adm.sp.k.worth", { v: m(cents(pend.in_lab.cents)) }) }) : null,
        pend ? k(t("adm.sp.k.toDeliver"), int(pend.to_deliver.count, lang), pend.to_deliver.count, { sub: t("adm.sp.k.toCollect", { v: m(cents(pend.to_deliver.balance_cents)) }) }) : null,
        pend ? k(t("adm.sp.k.onStreet"), m(cents(pend.on_street.cents)), cents(pend.on_street.cents), { neg: pend.on_street.cents > 0, sub: t("adm.sp.k.balances", { n: pend.on_street.count }) }) : null,
      ],
      summaries: bySource.filter((s) => s.orders > 0).length ? [{ title: t("adm.sp.rpt.channels"), pills: bySource.filter((s) => s.orders > 0).map((s) => ({ label: srcLabel(s.source), value: `${int(s.orders, lang)} · ${m(s.revenue)}` })) }] : [],
      tables: [{
        title: t("adm.sp.rpt.last"),
        main: true,
        cols: [
          { header: t("adm.sp.last.number"), get: (r) => saleNumber(r, t), width: 12 },
          { header: t("adm.sp.last.date"), key: "sold_at", type: "date", width: 11, text: (r) => shortDate(r.sold_at, lang) },
          { header: t("adm.sp.last.customer"), key: "customer", width: 24, get: (r) => r.customer || "" },
          { header: t("adm.sp.last.total"), key: "total", type: "money", width: 12 },
          { header: t("adm.sp.last.paid"), key: "paid", type: "money", width: 12 },
          { header: t("adm.sp.last.balance"), key: "balance", type: "money", width: 12, cls: (r) => (Number(r.balance) > 0 ? "neg" : "") },
        ],
        rows: lastSales,
        empty: t("adm.sp.last.empty"),
        note: fig?.hasMore ? t("adm.sp.last.more", { n: "…" }) : undefined,
      }],
      landscape: true,
      lang,
      t,
      filename: `${t("adm.sp.reportName")}-${code || "x"}-${from}_${to}`,
    };
  };

  const body = (
    <div className="sp-overlay" style={{ "--sp-left": `${left}px`, "--sp-color": color || undefined }}>
      <div className="sp-backdrop" onClick={close} aria-hidden="true" />
      <div className="sp-card" role="dialog" aria-modal="true" aria-label={t("adm.sp.title")} tabIndex={-1} ref={cardRef}>
        <button type="button" className="sp-close" onClick={close} aria-label={t("adm.sp.close")} title={t("adm.sp.close")}><Icon name="close" size={16} /></button>

        <div className="sp-head">
          <span className="sp-avatar">{initialsOf(name)}</span>
          <div className="sp-who">
            <h2>
              {base || baseErr ? name || "—" : <Skel w="40%" />}
              {code && <span className="sp-code" title={t("adm.sel.codeTitle")}>{code}</span>}
              {subject && subject.active === false && <span className="adm-chip bad">{t("adm.sp.inactive")}</span>}
            </h2>
            <small>
              <span><i className="sp-dot" style={{ background: color || "var(--adm-muted)" }} /> {subject ? storeText : baseErr === "seller_not_found" ? t("adm.sp.notFound") : ""}</span>
              {subject && <span className="sep">·</span>}
              {subject && <span><Icon name="percent" size={11} /> {t("adm.sp.commissionPct", { pct: subject.commission_pct })}</span>}
            </small>
          </div>
          <span className="sp-tools">
            <ExportMenu title={t("adm.sp.reportTitle", { name })} name={t("adm.sp.reportName")} compact={false} report={report} />
          </span>
        </div>

        <div className="sp-period" role="group" aria-label={t("adm.sp.period")}>
          <div className="sp-seg">
            {PERIODS.map((p) => (
              <button key={p} type="button" className={period === p ? "on" : ""} aria-pressed={period === p} onClick={() => pick(p)} title={t(`adm.ex.period.${p}`)}>{t(`adm.ex.per.${p}`)}</button>
            ))}
          </div>
          <span className="sp-dates">
            <Icon name="calendar" size={13} />
            <input type="date" value={from} max={to} aria-label={t("adm.ex.from")} onChange={(e) => setDate("from", e.target.value)} />
            –
            <input type="date" value={to} min={from} aria-label={t("adm.ex.to")} onChange={(e) => setDate("to", e.target.value)} />
          </span>
          <HelpTip topic="exec.period" size={13} />
        </div>

        <section className="sp-row" aria-label={t("adm.sp.row.sales")}>
          <div className="sp-row-head"><h3>{t("adm.sp.row.sales")}</h3><span>{from === to ? from : `${from} → ${to}`}</span></div>
          <div className="sp-grid">
            <Tile label={t("adm.sp.k.sales")} tone="hero" loading={loading} failed={failed || !tot} value={tot ? m(tot.sales) : "—"} sub={tot ? t("adm.sp.k.sales.n", { n: int(count, lang) }) : ""} onClick={toOrders} />
            <Tile label={t("adm.sp.k.count")} loading={loading} failed={failed || !tot} value={tot ? int(count, lang) : "—"} sub={tot ? `${int(tot.units, lang)} ${t("adm.sp.k.units").toLowerCase()}` : ""} onClick={toOrders} />
            <Tile label={t("adm.sp.k.ticket")} loading={loading} failed={failed || !tot} value={tot ? m(tot.avg_ticket) : "—"} sub="" />
            {showProfit && <Tile label={t("adm.sp.k.profit")} tone={Number(tot?.profit) < 0 ? "bad" : "good"} loading={loading} failed={failed || !tot} value={tot ? m(tot.profit) : "—"} sub={tot?.margin_pct != null ? t("adm.sp.k.margin", { pct: pct(tot.margin_pct) }) : ""} />}
            {showProfit && <Tile label={t("adm.sp.k.avgProfit")} loading={loading} failed={failed || !tot} value={avgProfit != null ? m(avgProfit) : "—"} sub="" help="exec.sellers.avgProfit" />}
            {showCommission && <Tile label={t("adm.sp.k.commission")} tone="gold" loading={loading} failed={failed || !tot} value={tot ? m(tot.commission) : "—"} sub={subject ? t("adm.sp.commissionPct", { pct: subject.commission_pct }) : ""} help="exec.sellers.commission" />}
            <Tile label={t("adm.sp.k.quota")} loading={loading} failed={failed || !tot} value={tot ? pct(share) : "—"} sub={storeTot ? t("adm.sp.k.ofStore", { v: m(storeTot.sales) }) : ""} help="exec.sellers.quota" />
          </div>
        </section>

        <section className="sp-row" aria-label={t("adm.sp.row.pending")}>
          <div className="sp-row-head"><h3>{t("adm.sp.row.pending")}</h3></div>
          <div className="sp-grid cols-3">
            <Tile label={t("adm.sp.k.inLab")} loading={!base && !baseErr} failed={!pend} value={pend ? int(pend.in_lab.count, lang) : "—"}
              sub={pend ? (pend.in_lab.count ? t("adm.sp.k.worth", { v: m(cents(pend.in_lab.cents)) }) : t("adm.sp.k.none")) : ""} onClick={() => toLab("in_lab")} />
            <Tile label={t("adm.sp.k.toDeliver")} tone={pend?.to_deliver.count ? "hero" : ""} loading={!base && !baseErr} failed={!pend} value={pend ? int(pend.to_deliver.count, lang) : "—"}
              sub={pend ? (pend.to_deliver.count ? t("adm.sp.k.toCollect", { v: m(cents(pend.to_deliver.balance_cents)) }) : t("adm.sp.k.none")) : ""} onClick={() => toLab("ready")} />
            <Tile label={t("adm.sp.k.onStreet")} tone={pend?.on_street.count ? "warn" : ""} loading={!base && !baseErr} failed={!pend} value={pend ? m(cents(pend.on_street.cents)) : "—"}
              sub={pend ? t("adm.sp.k.balances", { n: pend.on_street.count }) : ""} onClick={toBalances} />
          </div>
        </section>

        <section className="sp-row" aria-label={t("adm.sp.row.channels")}>
          <div className="sp-row-head"><h3>{t("adm.sp.row.channels")}</h3><span title={t("adm.sp.channels.hint")}><Icon name="info" size={11} /></span></div>
          {loading ? <Skel w="50%" /> : <SellerChannels by_source={bySource} />}
        </section>

        <section className="sp-row sp-last" aria-label={t("adm.sp.row.last")}>
          <div className="sp-row-head"><h3>{t("adm.sp.row.last")}</h3>{fig?.hasMore && <span>{t("adm.sp.last.more", { n: "100+" })}</span>}</div>
          {loading ? <div className="adm-skel" style={{ height: 60 }} /> : !lastSales.length ? <div className="adm-nodata">{t("adm.sp.last.empty")}</div> : (
            <div className="adm-table-wrap">
              <table className="adm-table dense responsive">
                <thead><tr><th>{t("adm.sp.last.number")}</th><th>{t("adm.sp.last.date")}</th><th>{t("adm.sp.last.customer")}</th><th className="r">{t("adm.sp.last.total")}</th><th className="r">{t("adm.sp.last.paid")}</th><th className="r">{t("adm.sp.last.balance")}</th></tr></thead>
                <tbody>
                  {lastSales.slice(0, LAST_SHOWN).map((r) => {
                    const clickable = typeof openSale === "function" && r.sale_id;
                    return (
                      <tr key={r.order_id} className={clickable ? "ord-row" : ""} onClick={clickable ? () => { openSale(r.sale_id, { economics: r }); } : undefined} title={clickable ? t("adm.sp.last.open") : undefined}>
                        <td data-label={t("adm.sp.last.number")}><b>{saleNumber(r, t)}</b></td>
                        <td data-label={t("adm.sp.last.date")}>{shortDate(r.sold_at, lang)}</td>
                        <td data-label={t("adm.sp.last.customer")}>{r.customer || "—"}</td>
                        <td data-label={t("adm.sp.last.total")} className="r num"><b>{m(r.total)}</b></td>
                        <td data-label={t("adm.sp.last.paid")} className="r num">{m(r.paid)}</td>
                        <td data-label={t("adm.sp.last.balance")} className={`r num ${Number(r.balance) > 0 ? "neg" : "muted"}`}>{Number(r.balance) > 0 ? m(r.balance) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {lastSales.length > LAST_SHOWN && <small className="sp-more">{t("adm.sp.last.more", { n: lastSales.length - LAST_SHOWN })}</small>}
            </div>
          )}
        </section>

        <div className="sp-foot">
          {failed && <p className="sp-err">{t(baseErr === "seller_not_found" ? "adm.sp.notFound" : "adm.sp.error")}</p>}
          {!failed && base?.truncated && <p className="sp-note">{t("adm.sp.truncated")}</p>}
          <button type="button" className="btn-sm ghost" onClick={close}>{t("adm.sp.close")}</button>
          {go && <button type="button" className="btn-sm primary" onClick={toOrders}><Icon name="orders" size={14} /> {t("adm.sp.orders")} <Icon name="chevronRight" size={14} /></button>}
        </div>
      </div>
    </div>
  );

  if (!host) return null;
  return createPortal(body, host);
}

/**
 * Estado del panel para cualquier pantalla: `open(códigoOId, { from, to,
 * store, period })` lo abre delante de lo que haya; `panel` se pinta donde sea
 * (es un portal). `go`, `openSale` y `me` se pasan al panel.
 */
export function useSellerPanel({ go, openSale, me } = {}) {
  const [cur, setCur] = useState(null);
  const open = useCallback((seller, filters = {}) => { if (seller) setCur({ seller: String(seller), filters: filters || {}, n: Date.now() }); }, []);
  const close = useCallback(() => setCur(null), []);
  const panel = useMemo(() => (cur ? <SellerPanel key={`${cur.seller}-${cur.n}`} seller={cur.seller} filters={cur.filters} onClose={close} go={go} openSale={openSale} me={me} /> : null), [cur, close, go, openSale, me]);
  return { open, close, panel, seller: cur?.seller || null };
}
