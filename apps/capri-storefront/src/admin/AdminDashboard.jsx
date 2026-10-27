// Dónde se usa: interior de /admin. Secciones Ejecutivo/Pedidos/Costos/Vendedores/Resumen/Ventas/Productos/Precios/Equipo/Seguridad dentro del armazón AdminShell (barra lateral de iconos).
import { useState, useEffect, useMemo, useSyncExternalStore, useRef } from "react";
import { KpiCard, LineChart, BarChart, DonutChart, Funnel, AccessVsBuyChart, WeekdayChart } from "./charts.jsx";
import { ensureSeed, summarize, summarizeOrders, rangeFor, subscribe as onAnalytics, clearDemo, productSales, productSalesFrom } from "./analytics.js";
// REAL analytics: the panel's Resumen/Ventas/Precios feed on the store's actual
// orders (Medusa order board) when the login is real; the demo seed only backs
// the demo login and the error fallback. See realAnalytics.js.
import { fetchBoardWindow, fetchRealAnalyticsOrders, buildCatalogIndex, toAnalyticsOrder } from "./realAnalytics.js";
import { isDemoLogin } from "./adminAuth.js";
import ExecutiveHub, { EXEC_TABS } from "./ExecutiveHub.jsx";
import { Card } from "./ui.jsx";
import { printElement } from "./exportUtils.js";
import CatalogManager from "./CatalogManager.jsx";
import Team from "./Team.jsx";
import Stores from "./Stores.jsx";
import Security from "./Security.jsx";
// The Orders tab is the one part of this panel backed by the real store: it
// reads and mutates Medusa orders instead of the seeded localStorage the other
// tabs still use. `money` is aliased because this file already has its own,
// which assumes dollars and knows nothing about an order's currency.
import {
  STAGES, STAGE_BY_KEY, TERMINALS, TERMINAL_BY_KEY,
  fetchOrders, setOrderStage, setOrderTracking, setOrderNote, ordersToCsv, downloadText,
  orderLabel, stageErrorText, money as fmtMoney, shortDate, fetchPrescription,
} from "./adminOrders.js";
import { fetchOrderCost, marginTone } from "./adminCosting.js";
import { fetchSellers } from "./adminSellers.js";
import AdminShell, { navGroupsFor, tabsOf } from "./AdminShell.jsx";
import StaffProfile from "./StaffProfile.jsx";
import AuditLog from "./AuditLog.jsx";
import PosSale from "./PosSale.jsx";
import PosSales from "./PosSales.jsx";
import PosApprovals from "./PosApprovals.jsx";
import PosConfig from "./PosConfig.jsx";
import AlertRules from "./AlertRules.jsx";
import Icon from "./icons.jsx";
import Costs from "./Costs.jsx";
import Sellers from "./Sellers.jsx";
import { TENANT } from "../config/tenant.js";
import { useCatalog } from "../data/catalogStore.js";
import { BRANDS, BRAND_BY_SLUG } from "../data/brands.js";
import * as PS from "./priceStore.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { DESIGNS, MATERIALS as LENS_MATERIALS, BASE, PHOTO, AR, L } from "../data/lensPricing.js";

const BRAND_LOGO_BY_NAME = Object.fromEntries(BRANDS.map((b) => [b.name, b.logo]));

const money = (n) => "$" + (Number(n) || 0).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n) => (Number(n) || 0).toLocaleString("es");
const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

// Visual bar list with a small product photo per row (icons with product thumbnails).
function ThumbBars({ data, imgByName, valuePrefix = "", emptyMsg }) {
  const { t } = useLang();
  if (!data || !data.length) return <div className="adm-nodata">{emptyMsg ?? t("adm.chart.noData")}</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="adm-thumbbars">
      {data.map((d, i) => {
        const img = imgByName && imgByName[d.label];
        return (
          <div className="adm-tb-row" key={i}>
            <div className="adm-tb-thumb">{img ? <img src={img} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = 0; }} /> : <span>◈</span>}</div>
            <div className="adm-tb-main">
              <div className="adm-tb-top"><span className="adm-tb-name" title={d.label}>{d.label}</span><b>{valuePrefix}{int(d.value)}</b></div>
              <div className="adm-tb-track"><div className="adm-tb-fill" style={{ width: (d.value / max * 100).toFixed(1) + "%" }} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Range keys only — the words come from the dictionary at render time, so the
// picker follows the language switch instead of freezing at first paint.
const RANGES = ["today", "7d", "30d", "90d", "ytd", "all"];

function RangePicker({ value, onChange }) {
  const { t } = useLang();
  return (
    <div className="adm-range">
      {RANGES.map((k) => (
        <button key={k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{t(`adm.range.${k}`)}</button>
      ))}
    </div>
  );
}

// re-render when analytics change (watch both daily buckets and orders)
const analyticsSnap = () => (localStorage.getItem("oer_daily") || "").length + ":" + (localStorage.getItem("oer_orders") || "").length;
function useAnalyticsTick() {
  return useSyncExternalStore(onAnalytics, analyticsSnap, () => "0:0");
}

function useSummary(preset) {
  const snap = useAnalyticsTick();
  return useMemo(() => summarize(rangeFor(preset)), [preset, snap]);
}

// REAL summary: same aggregation, fed by the store's actual orders. With the
// demo login (or while real orders fail to load) it falls back to the demo
// summarize so the charts never go blank. Returns the summary plus the source
// so the tabs can label what the numbers are ("real", "demo", "loading").
function useRealSummary(preset) {
  const snap = useAnalyticsTick();            // keeps the demo fallback live
  const demoMode = isDemoLogin();
  const { products, cases } = useCatalog();
  const [win, setWin] = useState(null);       // { orders, truncated, scanLimit }
  const [state, setState] = useState(demoMode ? "demo" : "loading");
  useEffect(() => {
    if (demoMode) { setState("demo"); return undefined; }
    let on = true;
    setState("loading");
    fetchBoardWindow(rangeFor(preset))
      .then((w) => { if (on) { setWin(w); setState("real"); } })
      .catch(() => { if (on) setState("error"); });
    return () => { on = false; };
  }, [preset, demoMode]);
  const catalogIndex = useMemo(() => buildCatalogIndex(products, cases), [products, cases]);
  const s = useMemo(() => {
    if (state === "real" && win) {
      // Revenue truth: canceled/refunded/payment-pending orders don't count.
      const revenue = (win.orders || []).filter((o) => !o.terminal).map((o) => toAnalyticsOrder(o, catalogIndex));
      return summarizeOrders(revenue, rangeFor(preset));
    }
    return summarize(rangeFor(preset));       // demo login / load error
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, win, catalogIndex, preset, snap]);
  return { s, source: state, truncated: state === "real" && win ? win.truncated : false, scanLimit: win?.scanLimit || 300 };
}

// Small banner naming the data source of the analytics tabs (real store data,
// scan-window note, or the demo/error fallback). Keys live in adm.real.*.
function SourceNote({ source, truncated, scanLimit }) {
  const { t } = useLang();
  if (source === "loading") return <div className="adm-src-note loading">{t("adm.real.loading")}</div>;
  if (source === "error") return <div className="adm-demo-banner">{t("adm.real.loadFailed")}</div>;
  if (source === "real") {
    return (
      <div className="adm-src-note real">
        <b>{t("adm.real.source")}</b>
        {truncated ? <span> · {t("adm.real.truncated", { n: int(scanLimit) })}</span> : null}
      </div>
    );
  }
  return null;
}

/* ---------------- Overview ---------------- */
function Overview({ preset, setPreset, go }) {
  const { t } = useLang();
  const { s, source, truncated, scanLimit } = useRealSummary(preset);
  const k = s.kpis;
  const { products } = useCatalog();
  const imgByName = useMemo(() => Object.fromEntries(products.map((p) => [p.name, p.colors?.[0]?.image])), [products]);
  // summarize() hands back dictionary keys for the labels it invents (weekdays,
  // funnel steps). Resolve them here, at the boundary, so the chart components
  // stay generic and just render whatever label they are given.
  const funnel = useMemo(() => s.funnel.map((f) => ({ ...f, label: t(f.label) })), [s.funnel, t]);
  const weekday = useMemo(() => s.weekday.map((w) => ({ ...w, label: t(w.label) })), [s.weekday, t]);
  return (
    <div className="adm-exec">
      <div className="adm-head-row compact"><span className="muted">{t("adm.exec.overviewSub")}</span><RangePicker value={preset} onChange={setPreset} /></div>
      <SourceNote source={source} truncated={truncated} scanLimit={scanLimit} />
      {s.hasDemo && (
        <div className="adm-demo-banner">
          <span dangerouslySetInnerHTML={{ __html: t("adm.demoBanner") }} />{" "}
          <button onClick={clearDemo}>{t("adm.clearDemo")}</button>
        </div>
      )}
      <div className="adm-kpis">
        <KpiCard label={t("adm.kpi.revenue")} value={money(k.revenue)} icon={<Icon name="dollar" />} sub={t("adm.kpi.unitsSub", { n: int(k.units) })} hint={t("adm.kpi.h.revenue")} onClick={() => go("exec", { sub: "detail" })} />
        <KpiCard label={t("adm.kpi.orders")} value={int(k.ordersCount)} icon={<Icon name="receipt" />} hint={t("adm.kpi.h.orders")} onClick={() => go("orders", { preset })} />
        <KpiCard label={t("adm.kpi.aov")} value={money(k.aov)} icon={<Icon name="trendUp" />} hint={t("adm.kpi.h.aov")} onClick={() => go("exec", { sub: "detail" })} />
        <KpiCard label={t("adm.kpi.access")} value={int(k.access)} icon={<Icon name="eye" />} sub={source === "real" ? t("adm.real.funnelLocal") : undefined} hint={t("adm.kpi.h.access")} />
        <KpiCard label={t("adm.kpi.conversion")} value={(k.conv || 0).toFixed(1) + "%"} icon={<Icon name="gauge" />} sub={t("adm.kpi.convSub")} hint={t("adm.kpi.h.conversion")} />
      </div>
      <div className="adm-grid-2">
        <Card title={t("adm.chart.salesByDay")} name="salesByDay" hint={t("adm.chart.salesByDay.h")}><LineChart data={s.salesSeries} valuePrefix="$" color="#0E5AD0" /></Card>
        <Card title={t("adm.chart.funnel")} name="funnel" hint={t("adm.chart.funnel.h")}><Funnel steps={funnel} /></Card>
      </div>
      <div className="adm-grid-2">
        <Card title={t("adm.chart.salesByBrand")} name="salesByBrand" hint={t("adm.chart.salesByBrand.h")}><DonutChart data={s.topBrands} iconByLabel={BRAND_LOGO_BY_NAME} /></Card>
        <Card title={t("adm.chart.topProducts")} name="topProducts" hint={t("adm.chart.topProducts.h")}><ThumbBars data={s.topProducts} imgByName={imgByName} valuePrefix="$" emptyMsg={t("adm.chart.noSales")} /></Card>
      </div>
      <Card title={t("adm.chart.accessVsBuy")} name="accessVsBuy" hint={t("adm.chart.accessVsBuy.h")}><p className="adm-sub">{t("adm.chart.accessVsBuySub")}</p><AccessVsBuyChart data={s.accessVsBuy} /></Card>
      <Card title={t("adm.chart.weekday")} name="weekday" hint={t("adm.chart.weekday.h")}><p className="adm-sub">{t("adm.chart.weekdaySub")}</p><WeekdayChart data={weekday} /></Card>
    </div>
  );
}

/* ---------------- Sales ---------------- */
function Sales({ preset, setPreset, go }) {
  const { t, lang } = useLang();
  const { s, source, truncated, scanLimit } = useRealSummary(preset);
  const recent = s.orders.slice(0, 40);
  return (
    <div className="adm-exec">
      <div className="adm-head-row compact"><span className="muted">{t("adm.exec.detailSub")}</span><RangePicker value={preset} onChange={setPreset} /></div>
      <SourceNote source={source} truncated={truncated} scanLimit={scanLimit} />
      <div className="adm-kpis">
        <KpiCard label={t("adm.kpi.revenue")} value={money(s.kpis.revenue)} icon={<Icon name="dollar" />} hint={t("adm.kpi.h.revenue")} onClick={() => go("exec", { sub: "costs" })} />
        <KpiCard label={t("adm.kpi.orders")} value={int(s.kpis.ordersCount)} icon={<Icon name="receipt" />} hint={t("adm.kpi.h.orders")} onClick={() => go("orders", { preset })} />
        <KpiCard label={t("adm.kpi.aov")} value={money(s.kpis.aov)} icon={<Icon name="trendUp" />} hint={t("adm.kpi.h.aov")} onClick={() => go("exec", { sub: "overview" })} />
        <KpiCard label={t("adm.kpi.units")} value={int(s.kpis.units)} icon={<Icon name="box" />} hint={t("adm.kpi.h.units")} onClick={() => go("products")} />
      </div>
      <div className="adm-grid-2">
        <Card title={t("adm.sales.revByDay")} name="revByDay" hint={t("adm.sales.revByDay.h")}><LineChart data={s.salesSeries} valuePrefix="$" /></Card>
        <Card title={t("adm.sales.ordersByDay")} name="ordersByDay" hint={t("adm.sales.ordersByDay.h")}><BarChart data={s.ordersSeries} color="#FD0E3F" /></Card>
      </div>
      <Card icon="clock" title={t("adm.sales.recent", { n: int(s.orders.length) })} name="pedidos-recientes" hint={t("adm.sales.recent.h")}>
        <div className="adm-table-wrap">
          <table className="adm-table responsive">
            <thead><tr><th>{t("adm.col.order")}</th><th>{t("adm.col.date")}</th><th>{t("adm.col.items")}</th><th className="r">{t("adm.col.total")}</th></tr></thead>
            <tbody>
              {recent.length === 0 ? <tr><td colSpan="4" className="muted">{t("adm.sales.noneInRange")}</td></tr> :
                recent.map((o) => (
                  <tr key={o.id} className="ord-row" onClick={() => go("orders", { order: o.id })} title={t("adm.exec.openOrder")}>
                    <td data-label={t("adm.col.order")}>{o.demo ? o.id : `#${o.display_id ?? o.id}`}{o.demo && <span className="tag-demo">{t("adm.demoTag")}</span>}</td>
                    <td data-label={t("adm.col.date")}>{shortDate(o.t, lang)}</td>
                    <td data-label={t("adm.col.items")}>{o.items.map((i) => i.name).slice(0, 3).join(", ")}{o.items.length > 3 ? "…" : ""}</td>
                    {/* Real orders carry their currency; demo ones fall back to USD. */}
                    <td data-label={t("adm.col.total")} className="r">{fmtMoney(o.total, o.currency || "usd", lang)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Products (new / discontinued over time) ---------------- */
function Products({ preset, setPreset }) {
  const { t, lang } = useLang();
  const { products, cases, meta } = useCatalog();
  const [history, setHistory] = useState(null);
  useEffect(() => {
    fetch("/catalog-history.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then(setHistory).catch(() => setHistory(null));
  }, []);

  const { from, to } = rangeFor(preset);
  const inRange = (d) => { const t = new Date(d).getTime(); return t >= from.getTime() && t <= to.getTime(); };

  const added = [], removed = [];
  if (Array.isArray(history)) {
    for (const h of history) if (inRange(h.date)) {
      for (const s of (h.added || [])) added.push({ sku: s, date: h.date });
      for (const s of (h.removed || [])) removed.push({ sku: s, date: h.date });
    }
  } else if (meta) {
    for (const s of (meta.added || [])) added.push({ sku: s, date: meta.lastSync });
    for (const s of (meta.removed || [])) removed.push({ sku: s, date: meta.lastSync });
  }

  const perBrand = meta?.perBrand || products.reduce((m, p) => (m[p.brand_slug] = (m[p.brand_slug] || 0) + 1, m), {});
  const brandRows = Object.entries(perBrand).sort((a, b) => b[1] - a[1]);
  const prodByKey = useMemo(() => { const m = {}; for (const p of products) m[normKey(p.sku)] = p; return m; }, [products]);
  const findP = (sku) => prodByKey[normKey(sku)];
  const ProdList = ({ list, empty }) => (
    <div className="adm-prodlist">
      {list.length === 0 ? <div className="adm-nodata">{empty}</div> : list.slice(0, 100).map((x, i) => {
        const p = findP(x.sku);
        return (
          <div className="adm-prodlist-row" key={i}>
            <div className="adm-tb-thumb sm">{p?.colors?.[0]?.image ? <img src={p.colors[0].image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = 0; }} /> : <span>◈</span>}</div>
            <div className="adm-pl-main"><b>{p?.name || x.sku}</b>{p && <small className="muted">{p.brand}</small>}</div>
            <small className="muted">{shortDate(x.date, lang)}</small>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>{t("adm.tab.products")}</h2><RangePicker value={preset} onChange={setPreset} /></div>
      {!history && <div className="adm-demo-banner" dangerouslySetInnerHTML={{ __html: t("adm.prod.noHistory") }} />}
      <div className="adm-kpis">
        <KpiCard label={t("adm.prod.frames")} value={int(products.length)} icon={<Icon name="glasses" />} />
        <KpiCard label={t("adm.prod.cases")} value={int(cases.length)} icon={<Icon name="box" />} />
        <KpiCard label={t("adm.prod.added")} value={int(added.length)} icon={<Icon name="sparkles" />} deltaGood />
        <KpiCard label={t("adm.prod.removed")} value={int(removed.length)} icon={<Icon name="alert" />} />
      </div>
      <div className="adm-grid-2">
        <div className="adm-card">
          <h3>{t("adm.prod.newTitle")}</h3>
          <ProdList list={added} empty={t("adm.prod.noAdded")} />
        </div>
        <div className="adm-card">
          <h3>{t("adm.prod.goneTitle")}</h3>
          <ProdList list={removed} empty={t("adm.prod.noRemoved")} />
        </div>
      </div>
      <div className="adm-card">
        <h3>{t("adm.prod.byBrand")}</h3>
        <ThumbBars
          data={brandRows.map(([slug, value]) => ({ label: (BRAND_BY_SLUG[slug]?.name) || slug, value }))}
          imgByName={Object.fromEntries(brandRows.map(([slug]) => { const b = BRAND_BY_SLUG[slug]; return [b?.name || slug, b?.logo]; }))}
        />
      </div>
    </div>
  );
}

/* ---------------- Prices ---------------- */
// [storageKey, dictionaryKey, basePrice]. The middle entry is a key, not a
// name: these rows are read by the shop owner, who may be working in English.
const MATERIALS = [
  ["1.50", "adm.mat.150", 0], ["1.59", "adm.mat.159", 20], ["1.61", "adm.mat.161", 35],
  ["1.67", "adm.mat.167", 60], ["1.74", "adm.mat.174", 95],
];
const TREATMENTS = [
  ["ar", "adm.trt.ar", 8], ["blue", "adm.trt.blue", 20], ["photo", "adm.trt.photo", 45], ["tint", "adm.trt.tint", 15],
];
const USAGE = [
  ["sv-dist", "adm.use.svDist", 6.95], ["sv-read", "adm.use.svRead", 6.95],
  ["progressive", "adm.use.progressive", 49], ["frame-only", "adm.use.frameOnly", 0],
];

function PriceInput({ value, placeholder, onCommit }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input className="adm-price-input" type="number" step="0.01" min="0" value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

function TxtInput({ value, placeholder, onCommit, wide }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input className={`adm-txt ${wide ? "wide" : ""}`} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

function ShippingConfig({ ov }) {
  const { t } = useLang();
  const sh = ov.shipping; const pk = sh.pickup || {}; const og = sh.origin || {};
  const zones = sh.zones || []; const carriers = sh.carriers || ["FedEx", "UPS", "USPS", "DHL", "Consignataria"];
  return (
    <div className="adm-card">
      <h3>{t("adm.ship.title")}</h3>
      <div className="adm-grid-2">
        <div className="ship-block">
          <div className="ship-h"><Icon name="store" size={16} /> {t("adm.ship.pickup")}
            <label className="ship-toggle"><input type="checkbox" checked={!!pk.enabled} onChange={(e) => PS.setPickup({ enabled: e.target.checked })} /> {t("adm.ship.active")}</label>
          </div>
          <div className="ship-fields">
            <label>{t("adm.ship.name")}<TxtInput value={pk.name} onCommit={(v) => PS.setPickup({ name: v })} wide /></label>
            <label>{t("adm.ship.address")}<TxtInput value={pk.address} onCommit={(v) => PS.setPickup({ address: v })} wide /></label>
            <label>{t("adm.ship.city")}<TxtInput value={pk.city} onCommit={(v) => PS.setPickup({ city: v })} wide /></label>
            <label>{t("adm.ship.hours")}<TxtInput value={pk.hours} onCommit={(v) => PS.setPickup({ hours: v })} wide /></label>
            <label>{t("adm.ship.mapUrl")}<TxtInput value={pk.mapsUrl} onCommit={(v) => PS.setPickup({ mapsUrl: v })} wide /></label>
            {/* Vive en shipping (no en pickup): el mismo plazo aplica a lo que se
                envía, porque el laboratorio tarda igual. */}
            <label>{t("adm.ship.labDays")}<PriceInput value={sh.labDays} placeholder="10" onCommit={(v) => PS.setShipping({ labDays: Math.max(0, Math.round(Number(v) || 0)) })} /></label>
          </div>
          <p className="muted">{t("adm.ship.labDaysHint")}</p>
        </div>
        <div className="ship-block">
          <div className="ship-h"><Icon name="box" size={16} /> {t("adm.ship.origin")}</div>
          <div className="ship-fields">
            <label>{t("adm.ship.name")}<TxtInput value={og.name} onCommit={(v) => PS.setOrigin({ name: v })} wide /></label>
            <label>{t("adm.ship.address")}<TxtInput value={og.address} onCommit={(v) => PS.setOrigin({ address: v })} wide /></label>
            <label>{t("adm.ship.city")}<TxtInput value={og.city} onCommit={(v) => PS.setOrigin({ city: v })} wide /></label>
          </div>
          <div className="ship-h" style={{ marginTop: 12 }}><Icon name="dollar" size={16} /> {t("adm.ship.baseCost")}</div>
          <div className="ship-fields r3">
            <label>{t("adm.ship.standard")}<PriceInput value={sh.standard} placeholder="4.95" onCommit={(v) => PS.setShipping({ standard: Number(v) || 0 })} /></label>
            <label>{t("adm.ship.express")}<PriceInput value={sh.express} placeholder="12.95" onCommit={(v) => PS.setShipping({ express: Number(v) || 0 })} /></label>
            <label>{t("adm.ship.freeFrom")}<PriceInput value={sh.freeThreshold} placeholder="59" onCommit={(v) => PS.setShipping({ freeThreshold: Number(v) || 0 })} /></label>
          </div>
        </div>
      </div>
      <div className="ship-h" style={{ marginTop: 14 }}><Icon name="globe" size={16} /> {t("adm.ship.zones")}
        <button className="btn-sm" onClick={PS.addZone}><Icon name="plus" size={14} />{t("adm.ship.addZone")}</button></div>
      <div className="adm-table-wrap">
        <table className="adm-table zones">
          <thead><tr><th>{t("adm.ship.destination")}</th><th>{t("adm.ship.carrier")}</th><th>{t("adm.ship.cost")}</th><th>{t("adm.ship.days")}</th><th></th></tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td><TxtInput value={z.name} onCommit={(v) => PS.updateZone(z.id, { name: v })} wide /></td>
                <td><select className="adm-sel" value={z.carrier} onChange={(e) => PS.updateZone(z.id, { carrier: e.target.value })}>
                  {[...new Set([z.carrier, ...carriers])].filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                <td><PriceInput value={z.cost} onCommit={(v) => PS.updateZone(z.id, { cost: Number(v) || 0 })} /></td>
                <td className="eta"><PriceInput value={z.etaMin} onCommit={(v) => PS.updateZone(z.id, { etaMin: Number(v) || 0 })} /><span>–</span><PriceInput value={z.etaMax} onCommit={(v) => PS.updateZone(z.id, { etaMax: Number(v) || 0 })} /></td>
                <td><button className="btn-sm danger" title={t("adm.ship.removeZone")} onClick={() => PS.removeZone(z.id)}><Icon name="trash" size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{t("adm.ship.note")}</p>
    </div>
  );
}

// Categories (columns) for the fotocromáticos / transitions table.
const LENS_PHOTO_CATS = ["sv", "bifocal", "prog"];

// "Lista de precios 2026 · Lentes": base matrix + fotocromáticos + antirreflejos.
function LensPriceList() {
  const { t, lang } = useLang();
  const [, force] = useState(0);
  useEffect(() => PS.subscribe(() => force((n) => n + 1)), []);
  return (
    <div className="adm-card lens-pl">
      <h3>{t("adm.lens.title")}</h3>

      <div className="lens-sub">
        <h4>{t("adm.lens.base")}</h4>
        <div className="adm-table-wrap">
          <table className="adm-table lens-tbl">
            <thead>
              <tr>
                <th>{t("adm.lens.design")}</th>
                {LENS_MATERIALS.map((m) => <th key={m.id} className="r">{L(m.label, lang)}</th>)}
              </tr>
            </thead>
            <tbody>
              {DESIGNS.map((d) => (
                <tr key={d.id}>
                  <td><b>{L(d.label, lang)}</b></td>
                  {LENS_MATERIALS.map((m) => {
                    const base = BASE[d.id][m.id];
                    return (
                      <td key={m.id} className="r">
                        <PriceInput value={PS.lensBasePrice(d.id, m.id, base)} placeholder={String(base)} onCommit={(v) => PS.setLensBase(d.id, m.id, v)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lens-sub">
        <h4>{t("adm.lens.photo")}</h4>
        <div className="adm-table-wrap">
          <table className="adm-table lens-tbl">
            <thead>
              <tr>
                <th>{t("adm.lens.type")}</th>
                {LENS_PHOTO_CATS.map((k) => <th key={k} className="r">{t(`adm.lens.cat.${k}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {PHOTO.map((p) => (
                <tr key={p.id}>
                  <td><b>{L(p.label, lang)}</b></td>
                  {LENS_PHOTO_CATS.map((cat) => {
                    const base = p.price[cat];
                    return (
                      <td key={cat} className="r">
                        {base === null
                          ? <span className="muted">—</span>
                          : <PriceInput value={PS.lensPhotoPrice(p.id, cat, base)} placeholder={String(base)} onCommit={(v) => PS.setLensPhoto(p.id, cat, v)} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lens-sub">
        <h4>{t("adm.lens.ar")}</h4>
        <div className="adm-grid-2">
          <div className="lens-ar-group">
            <div className="lens-ar-h">{t("adm.lens.arSv")}</div>
            {AR.sv.map((a) => (
              <div className="adm-price-row" key={a.id}>
                <span>{L(a.label, lang)}</span>
                <PriceInput value={PS.lensARPrice(a.id, a.price)} placeholder={String(a.price)} onCommit={(v) => PS.setLensAR(a.id, v)} />
              </div>
            ))}
          </div>
          <div className="lens-ar-group">
            <div className="lens-ar-h">{t("adm.lens.arBifProg")}</div>
            {AR.bifprog.map((a) => (
              <div className="adm-price-row" key={a.id}>
                <span>{L(a.label, lang)}</span>
                <PriceInput value={PS.lensARPrice(a.id, a.price)} placeholder={String(a.price)} onCommit={(v) => PS.setLensAR(a.id, v)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Prices({ preQ }) {
  const { t } = useLang();
  const { toast, confirm } = useFeedback();
  const { products, cases } = useCatalog();
  const [ov, setOv] = useState(PS.getOverrides());
  useEffect(() => PS.subscribe(() => setOv(PS.getOverrides())), []);
  const [q, setQ] = useState("");
  useEffect(() => { if (preQ != null) setQ(preQ); }, [preQ]);
  const fileRef = useRef(null);

  const frames = useMemo(() => products.filter((p) => `${p.name} ${p.brand}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200), [products, q]);
  // Units sold per product: REAL orders when the login is real (newest scan
  // window of the whole history); demo localStorage otherwise or on error.
  const [sales, setSales] = useState(() => productSales());
  useEffect(() => {
    if (isDemoLogin()) return undefined;
    let on = true;
    fetchBoardWindow(rangeFor("all"))
      .then((w) => {
        if (!on) return;
        const real = (w.orders || []).filter((o) => !o.terminal).map((o) => toAnalyticsOrder(o, null));
        setSales(productSalesFrom(real));
      })
      .catch(() => { /* keep demo fallback */ });
    return () => { on = false; };
  }, []);

  // shared product price row: photo + name + (hover) units bought this month + never-sold tag
  const ProdRow = ({ p, value, onCommit }) => {
    const key = normKey(p.sku);
    const m = sales.month[key] || 0, ev = sales.ever[key] || 0;
    const img = p.colors?.[0]?.image;
    return (
      <div className={`adm-price-row prod ${ev === 0 ? "never" : ""}`}>
        <div className="adm-pp-left">
          <div className="adm-tb-thumb sm">{img ? <img src={img} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.opacity = 0; }} /> : <span>◈</span>}</div>
          <span className="adm-pp-name">{p.name} <small className="muted">{p.brand ? p.brand + " · " : ""}{t("adm.prices.base")} {money(p.basePrice ?? p.price)}</small></span>
        </div>
        <div className="adm-pp-right">
          {ev === 0
            ? <span className="pp-tag never" title={t("adm.prices.neverSoldTitle")}>{t("adm.prices.neverSold")}</span>
            : <span className="pp-tag sold"><Icon name="orders" size={12} /> {m} <em>{t("adm.prices.thisMonth")}</em></span>}
          <PriceInput value={value} placeholder={String(p.basePrice ?? p.price)} onCommit={onCommit} />
        </div>
      </div>
    );
  };

  const doImport = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        PS.importJSON(rd.result);
        toast({ tone: "success", title: t("adm.importOk"), message: t("adm.importOkBody") });
      } catch {
        toast({ tone: "error", title: t("adm.importInvalid"), message: t("adm.importInvalidBody") });
      }
    };
    rd.onerror = () => toast({ tone: "error", title: t("adm.importInvalid"), message: t("adm.importInvalidBody") });
    rd.readAsText(f);
    e.target.value = ""; // allow re-picking the same file after a failed import
  };

  const doReset = async () => {
    const ok = await confirm({
      tone: "danger",
      title: t("adm.resetTitle"),
      message: t("adm.resetBody"),
      confirmLabel: t("adm.resetConfirm"),
    });
    if (!ok) return;
    PS.resetAll();
    toast({ tone: "success", title: t("adm.resetDone"), message: t("adm.resetDoneBody") });
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.prices.title")}</h2>
        <div className="adm-actions">
          <button className="btn-sm" onClick={PS.exportJSON}><Icon name="download" size={14} />{t("adm.prices.export")}</button>
          <button className="btn-sm" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} />{t("adm.prices.import")}</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={doImport} />
          <button className="btn-sm danger" onClick={doReset}><Icon name="rotate" size={14} />{t("adm.prices.reset")}</button>
        </div>
      </div>
      <p className="muted">{t("adm.prices.hint")}</p>

      <div className="adm-grid-2">
        <div className="adm-card">
          <h3>{t("adm.prices.materials")}</h3>
          {MATERIALS.map(([k, label, base]) => (
            <div className="adm-price-row" key={k}><span>{t(label)} <small className="muted">{t("adm.prices.base")} ${base}</small></span>
              <PriceInput value={ov.materials[k]} placeholder={String(base)} onCommit={(v) => PS.setMaterialPrice(k, v)} /></div>
          ))}
          <h3 style={{ marginTop: 14 }}>{t("adm.prices.treatments")}</h3>
          {TREATMENTS.map(([k, label, base]) => (
            <div className="adm-price-row" key={k}><span>{t(label)} <small className="muted">{t("adm.prices.base")} ${base}</small></span>
              <PriceInput value={ov.treatments[k]} placeholder={String(base)} onCommit={(v) => PS.setTreatmentPrice(k, v)} /></div>
          ))}
        </div>
        <div className="adm-card">
          <h3>{t("adm.prices.usage")}</h3>
          {USAGE.map(([k, label, base]) => (
            <div className="adm-price-row" key={k}><span>{t(label)} <small className="muted">{t("adm.prices.base")} ${base}</small></span>
              <PriceInput value={ov.usage[k]} placeholder={String(base)} onCommit={(v) => PS.setUsagePrice(k, v)} /></div>
          ))}
        </div>
      </div>

      <ShippingConfig ov={ov} />

      <div className="adm-card">
        <h3>{t("adm.prices.cases")}</h3>
        <div className="adm-price-grid">
          {cases.map((c) => (
            <ProdRow key={c.slug} p={c} value={ov.cases[c.sku]} onCommit={(v) => PS.setCasePrice(c.sku, v)} />
          ))}
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-head-row"><h3>{t("adm.prices.frames", { n: int(products.length) })}</h3>
          <input className="adm-search" placeholder={t("adm.prices.searchModel")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {Object.entries(frames.reduce((m, p) => { (m[p.brand] = m[p.brand] || []).push(p); return m; }, {}))
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([brand, list]) => (
            <div className="adm-brand-group" key={brand}>
              <div className="adm-brand-h">
                {BRAND_LOGO_BY_NAME[brand] && <img src={BRAND_LOGO_BY_NAME[brand]} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                <span>{brand}</span><small className="muted">({list.length})</small>
              </div>
              <div className="adm-price-grid">
                {list.map((p) => <ProdRow key={p.slug} p={p} value={ov.frames[p.sku]} onCommit={(v) => PS.setFramePrice(p.sku, v)} />)}
              </div>
            </div>
          ))}
        {products.length > 200 && <p className="muted">{t("adm.prices.capped")}</p>}
      </div>

      <LensPriceList />
    </div>
  );
}

/* ───────────────────────────  Pedidos (Medusa)  ───────────────────────────
 * Real orders from the Admin API. Every filter, stage and transition shown here
 * comes from the server: `stage` is what the customer's tracking page shows, and
 * `next_stages` is what the API will actually accept — the panel never decides
 * for itself which move is legal, so a button that exists always works.
 *
 * Paridad con la hoja de Google: lo que el dueño puede tocar allí (Estado y
 * Guía) se puede tocar aquí, y además la nota interna y la ficha de costo; cada
 * cambio se replica a la hoja en el acto, y lo que se edite en la hoja llega
 * aquí en ≤1 min (job gsheet-watch).
 */

const PAGE_SIZE = 20;

const DATE_PRESETS = ["today", "7d", "30d", "90d", "all"];

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function presetFrom(preset) {
  if (preset === "today") return ymd(Date.now());
  const days = { "7d": 7, "30d": 30, "90d": 90 }[preset];
  return days ? ymd(Date.now() - days * 864e5) : "";
}

/** Icono profesional por etapa / estado terminal (sustituye a los emojis). */
const STAGE_ICON = { confirmed: "receipt", in_lab: "lab", shipped: "box", in_transit: "truck", delivered: "checkCircle", payment_pending: "clock", canceled: "alert", refunded: "undo" };

/** Coloured pill for the stage, or for the terminal state that replaced it. */
function StageBadge({ order }) {
  const { t } = useLang();
  const term = order.terminal && TERMINAL_BY_KEY[order.terminal];
  if (term && order.terminal !== "payment_pending") {
    return <span className="ord-badge" style={{ background: term.bg, color: term.color }}><Icon name={STAGE_ICON[order.terminal]} size={13} /> {t(term.label)}</span>;
  }
  const st = STAGE_BY_KEY[order.stage] || STAGE_BY_KEY.confirmed;
  return (
    <span className="ord-badge" style={{ background: st.bg, color: st.color }}>
      <Icon name={STAGE_ICON[st.key]} size={13} /> {t(st.label)}
      {term && <span className="ord-badge-sub" title={t("adm.ord.paymentPending")}> · <Icon name="clock" size={12} /></span>}
    </span>
  );
}

/**
 * The "advance" control. Only `order.next_stages` is offered. Moving to
 * `in_transit` asks for the courier reference first, because that number is
 * what the customer's tracking page renders.
 */
function StageControl({ order, busy, onMove }) {
  const { t } = useLang();
  const [asking, setAsking] = useState(null);
  const [tracking, setTracking] = useState(order.tracking_number || "");
  const [trackUrl, setTrackUrl] = useState(order.tracking_url || "");
  const next = order.next_stages || [];

  if (!next.length) return <span className="muted ord-nomove">{t("adm.ord.noMoves")}</span>;

  if (asking) {
    return (
      <form
        className="ord-track-form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onMove(asking, { trackingNumber: tracking.trim(), trackingUrl: trackUrl.trim() });
          setAsking(null);
        }}
      >
        <input autoFocus placeholder={t("adm.ord.trackingPh")} value={tracking} onChange={(e) => setTracking(e.target.value)} />
        <input type="url" placeholder={t("adm.ord.trackingUrlPh")} value={trackUrl} onChange={(e) => setTrackUrl(e.target.value)} />
        <button className="btn-sm primary" disabled={busy}><Icon name="check" size={14} />{t("adm.ord.confirm")}</button>
        <button type="button" className="btn-sm" onClick={() => setAsking(null)}>{t("adm.ord.cancel")}</button>
      </form>
    );
  }

  return (
    <div className="ord-moves" onClick={(e) => e.stopPropagation()}>
      {next.map((key) => {
        const st = STAGE_BY_KEY[key];
        return (
          <button key={key} className="btn-sm ord-move" disabled={busy} title={t(st.action)}
            onClick={() => (key === "in_transit" ? setAsking(key) : onMove(key, {}))}>
            <Icon name={STAGE_ICON[key]} size={14} /> {t(st.label)}
          </button>
        );
      })}
    </div>
  );
}

// Visor bajo demanda de la receta de una línea: valores clave + imágenes
// (prueba virtual y receta subida) desde /admin/prescriptions/:id.
function RxImages({ prescriptionId }) {
  const { t } = useLang();
  const [state, setState] = useState("idle");
  const [data, setData] = useState(null);
  const load = async () => {
    if (state === "loading") return;
    setState("loading");
    try { setData(await fetchPrescription(prescriptionId)); setState("done"); } catch { setState("error"); }
  };
  if (state === "idle") return <button type="button" className="ord-rxbtn" onClick={load}><Icon name="eye" size={14} />{t("adm.ord.viewRx")}</button>;
  if (state === "loading") return <p className="ord-rxnote muted">{t("adm.ord.rxLoading")}</p>;
  if (state === "error") return <button type="button" className="ord-rxbtn" onClick={load}><Icon name="refresh" size={14} />{t("adm.ord.rxRetry")}</button>;
  const rx = data?.prescription || {};
  const tryon = data?.tryon_download_url;
  const file = data?.file_download_url;
  const mm = (v) => (v == null ? "—" : `${v} mm`);
  const patient = rx.patient_for === "other" ? (rx.patient_name || t("adm.ord.rxOther")) : rx.patient_for === "me" ? t("adm.ord.rxMe") : null;
  const pdText = rx.pd != null ? mm(rx.pd) : `OD ${mm(rx.pd_od)} · OS ${mm(rx.pd_os)}`;
  return (
    <div className="ord-rxview">
      <div className="ord-rxvals">
        {patient && <span><b>{t("adm.ord.rxFor")}:</b> {patient}</span>}
        <span><b>{t("lens.pd")}:</b> {pdText}</span>
        {rx.seg_height != null && <span><b>{t("adm.ord.rxHeight")}:</b> {mm(rx.seg_height)}</span>}
      </div>
      {(tryon || file) ? (
        <div className="ord-rximgs">
          {tryon && <a href={tryon} target="_blank" rel="noopener noreferrer"><img src={tryon} alt={t("adm.ord.rxTryon")} loading="lazy" /><span>{t("adm.ord.rxTryon")}</span></a>}
          {file && <a href={file} target="_blank" rel="noopener noreferrer"><img src={file} alt={t("adm.ord.rxPhotoImg")} loading="lazy" /><span>{t("adm.ord.rxPhotoImg")}</span></a>}
        </div>
      ) : <p className="ord-rxnote muted">{t("adm.ord.rxNoImages")}</p>}
    </div>
  );
}

/** Mini ficha de costo del pedido (lectura; la edición vive en Costos). */
function OrderCostMini({ orderId, onGoCosts }) {
  const { t, lang } = useLang();
  const [sheet, setSheet] = useState(null);
  const [state, setState] = useState("loading");
  useEffect(() => {
    let on = true;
    fetchOrderCost(orderId).then((s) => { if (on) { setSheet(s); setState("ok"); } }).catch(() => { if (on) setState("error"); });
    return () => { on = false; };
  }, [orderId]);
  if (state === "loading") return <div className="adm-skel" style={{ height: 36, marginTop: 8 }} />;
  if (state === "error" || !sheet) return null;
  const good = sheet.profit_gap == null ? marginTone(sheet.margin_pct) !== "bad" : sheet.profit_gap >= 0;
  return (
    <div className="ord-cost-mini">
      <span>{t("adm.cost.gross")}: <b>{fmtMoney(sheet.gross ?? sheet.revenue, sheet.currency_code, lang)}</b></span>
      <span>{t("adm.cost.netBase")}: <b>{fmtMoney(sheet.net_base, sheet.currency_code, lang)}</b></span>
      <span>{t("adm.cost.cost")}: <b className="bad">{fmtMoney(sheet.cost_total, sheet.currency_code, lang)}</b></span>
      <span>{t("adm.cost.ownerProfit")}: <b className={good ? "good" : "bad"}>{fmtMoney(sheet.margin, sheet.currency_code, lang)}</b> <span className={`margin-pct ${good ? "good" : "bad"}`}>{sheet.profit_pct_net == null ? "" : `${Math.round(sheet.profit_pct_net)}% ${t("adm.cost.ofNetShort")}`}</span></span>
      {sheet.profit_target_pct != null && <span className={`adm-chip ${good ? "ok" : "bad"}`}><Icon name="gauge" size={12} />{t("adm.cost.targetLine", { pct: sheet.profit_target_pct })} · {good ? "+" : "−"}{fmtMoney(Math.abs(sheet.profit_gap || 0), sheet.currency_code, lang)}</span>}
      {sheet.manual && <span className="adm-chip gold"><Icon name="edit" size={12} />{t("adm.cost.manual")}</span>}
      <button type="button" className="btn-xs" onClick={(e) => { e.stopPropagation(); onGoCosts(orderId); }}><Icon name="costs" size={13} />{t("adm.cost.openSheet")}</button>
    </div>
  );
}

/**
 * "Cambiar estado": el mismo cambio que los botones de la fila, como lista
 * desplegable con la etapa actual marcada. Solo ofrece las etapas que el
 * servidor acepta (`next_stages`); "En camino" pide la guía antes de confirmar.
 */
function StageSelect({ order, busy, onMove }) {
  const { t } = useLang();
  const [target, setTarget] = useState("");
  const [tracking, setTracking] = useState(order.tracking_number || "");
  const [trackUrl, setTrackUrl] = useState(order.tracking_url || "");
  const next = order.next_stages || [];
  const current = order.terminal && order.terminal !== "payment_pending" ? TERMINAL_BY_KEY[order.terminal] : STAGE_BY_KEY[order.stage];
  const submit = (e) => { e.preventDefault(); if (!target) return; onMove(target, target === "in_transit" ? { trackingNumber: tracking.trim(), trackingUrl: trackUrl.trim() } : {}); setTarget(""); };
  return (
    <form className="ord-edit-row ord-stage-form" onSubmit={submit}>
      <select className="adm-sel" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy || !next.length} style={{ flex: 1, minWidth: 160 }}>
        <option value="">{t("adm.ord.currentStage", { stage: current ? t(current.label) : order.stage })}</option>
        {next.map((k) => <option key={k} value={k}>→ {t(STAGE_BY_KEY[k].label)}</option>)}
      </select>
      {target === "in_transit" && (
        <>
          <input value={tracking} placeholder={t("adm.ord.trackingPh")} onChange={(e) => setTracking(e.target.value)} />
          <input type="url" value={trackUrl} placeholder={t("adm.ord.trackingUrlPh")} onChange={(e) => setTrackUrl(e.target.value)} />
        </>
      )}
      <button className="btn-sm primary" disabled={!target || busy}><Icon name="check" size={14} />{t("adm.ord.applyStage")}</button>
      {!next.length && <small className="muted">{t("adm.ord.noMoves")}</small>}
    </form>
  );
}

function OrderDetail({ order, onPatched, onGoCosts, onMove }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const addr = order.shipping_address;
  const [tracking, setTracking] = useState(order.tracking_number || "");
  const [trackUrl, setTrackUrl] = useState(order.tracking_url || "");
  const [note, setNote] = useState(order.owner_note || "");
  const [busy, setBusy] = useState("");
  useEffect(() => { setTracking(order.tracking_number || ""); setTrackUrl(order.tracking_url || ""); setNote(order.owner_note || ""); }, [order]);

  const saveTracking = async () => {
    setBusy("tracking");
    try {
      const o = await setOrderTracking(order.id, { trackingNumber: tracking.trim(), trackingUrl: trackUrl.trim() });
      toast({ tone: "success", title: t("adm.ord.trackingSaved") });
      onPatched(o);
    } catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.ord.saveFailed") }); } finally { setBusy(""); }
  };
  const saveNote = async () => {
    setBusy("note");
    try {
      const o = await setOrderNote(order.id, note.trim());
      toast({ tone: "success", title: t("adm.ord.noteSaved") });
      onPatched(o);
    } catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.ord.saveFailed") }); } finally { setBusy(""); }
  };
  const history = order.stage_history || [];

  return (
    <div className="ord-detail-grid" onClick={(e) => e.stopPropagation()}>
      <div>
        <b>{t("adm.ord.itemsTitle")}</b>
        <ul>
          {order.items.map((it) => (
            <li key={it.id} className="ord-li">
              <div className="ord-li-row">
                <span>
                  {it.quantity > 1 && <em className="ord-qty">{it.quantity}× </em>}
                  {it.title}
                  {it.has_prescription && <span className="ord-rx" title={t("adm.ord.rxTitle")}><Icon name="glasses" size={12} />{t("adm.ord.rx")}</span>}
                </span>
                <b>{fmtMoney(it.total, order.currency_code, lang)}</b>
              </div>
              {it.has_prescription && it.prescription_id && <RxImages prescriptionId={it.prescription_id} />}
            </li>
          ))}
        </ul>
        <p className="ord-totals muted">
          {t("adm.ord.totalsLine", {
            items: fmtMoney(order.item_total, order.currency_code, lang),
            shipping: fmtMoney(order.shipping_total, order.currency_code, lang),
            tax: fmtMoney(order.tax_total, order.currency_code, lang),
          })}
        </p>
        <OrderCostMini orderId={order.id} onGoCosts={onGoCosts} />
        {history.length > 0 && (
          <>
            <b style={{ display: "block", marginTop: 12 }}>{t("adm.ord.timeline")}</b>
            <ul className="ord-timeline">
              {history.slice().reverse().map((h, i) => (
                <li className="ord-tl" key={i}><b>{STAGE_BY_KEY[h.stage] ? t(STAGE_BY_KEY[h.stage].label) : h.stage}</b><span>{new Date(h.at).toLocaleString(lang === "en" ? "en-US" : "es")}</span></li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div>
        <b>{addr ? t("adm.ord.deliveryTitle") : t("adm.ord.pickupTitle")}</b>
        {addr ? (
          <p className="ord-addr">
            <span><Icon name="mapPin" size={14} />{[addr.address_1, addr.address_2].filter(Boolean).join(", ")}{addr.city ? `, ${addr.city}` : ""}{addr.postal_code ? ` (${addr.postal_code})` : ""}</span>
            <span><Icon name="user" size={14} />{order.customer.name || "—"}{order.customer.phone ? ` · ${order.customer.phone}` : ""}</span>
            <span><Icon name="mail" size={14} />{order.customer.email || "—"}</span>
            {order.shipping_method && <span><Icon name="truck" size={14} />{order.shipping_method}</span>}
          </p>
        ) : (
          <p className="ord-addr muted">
            <span><Icon name="store" size={14} />{t("adm.ord.noAddress")}</span>
            <span><Icon name="user" size={14} />{order.customer.name || "—"}{order.customer.phone ? ` · ${order.customer.phone}` : ""}</span>
            <span><Icon name="mail" size={14} />{order.customer.email || "—"}</span>
          </p>
        )}
        {order.seller_code && <p className="ord-addr"><span><Icon name="sellers" size={14} />{t("adm.ord.seller")}: <b>{order.seller_code}</b>{order.seller_source ? <span className="adm-chip neutral" style={{ marginLeft: 6 }}>{t(`adm.src.${order.seller_source}`) === `adm.src.${order.seller_source}` ? order.seller_source : t(`adm.src.${order.seller_source}`)}</span> : null}</span></p>}
        <b style={{ display: "block", marginTop: 12 }}>{t("adm.ord.changeStage")}</b>
        <StageSelect order={order} busy={busy === "stage"} onMove={onMove} />
        {order.lab_stage && <p className="ord-addr muted"><span><Icon name="lab" size={14} />{t("adm.ord.labPinned", { stage: t(STAGE_BY_KEY[order.lab_stage]?.label ?? order.lab_stage) })}</span></p>}

        <b style={{ display: "block", marginTop: 12 }}>{t("adm.ord.tracking")}</b>
        <div className="ord-edit-row">
          <input value={tracking} placeholder={t("adm.ord.trackingPh")} onChange={(e) => setTracking(e.target.value)} />
          <input type="url" value={trackUrl} placeholder={t("adm.ord.trackingUrlPh")} onChange={(e) => setTrackUrl(e.target.value)} />
          <button type="button" className="btn-sm primary" disabled={busy === "tracking" || (tracking.trim() === (order.tracking_number || "") && trackUrl.trim() === (order.tracking_url || ""))} onClick={saveTracking}><Icon name="save" size={14} />{t("adm.ord.save")}</button>
        </div>
        <b style={{ display: "block", marginTop: 12 }}>{t("adm.ord.note")}</b>
        <div className="ord-edit-row">
          <textarea value={note} maxLength={1000} placeholder={t("adm.ord.notePh")} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn-sm primary" disabled={busy === "note" || note.trim() === (order.owner_note || "")} onClick={saveNote}><Icon name="save" size={14} />{t("adm.ord.save")}</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}><Icon name="sheet" size={12} /> {t("adm.ord.sheetSync")}</p>
      </div>
    </div>
  );
}

// Enlace directo a un pedido (`/admin?tab=orders&order=<id>`), tal como lo
// enlaza la hoja de Google (Archivo → receta / foto de la prueba virtual).
function deepLinkedOrder() {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("order") || "").trim();
}

export function Orders({ onGoCosts, sellers = [], params = {} }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  // Llega desde la hoja (`?order=`) o desde otra pantalla del panel (`go("orders", {...})`).
  const [linked] = useState(() => params.order || deepLinkedOrder());
  const initialPreset = params.preset || (linked ? "all" : "30d");
  const [query, setQuery] = useState(linked || params.q || "");
  const [debounced, setDebounced] = useState(linked || params.q || "");
  const [preset, setPreset] = useState(initialPreset);
  const [from, setFrom] = useState(() => (initialPreset === "today" ? ymd(Date.now()) : presetFrom(initialPreset)));
  const [to, setTo] = useState("");
  const [stage, setStage] = useState(params.stage || "");
  const [terminal, setTerminal] = useState(params.terminal || "");
  const [rx, setRx] = useState("");
  const [seller, setSeller] = useState(params.seller || "");
  const tableRef = useRef(null);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { const id = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(id); }, [query]);
  useEffect(() => { setPage(0); }, [debounced, from, to, stage, terminal, rx, seller]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchOrders({ q: debounced, from, to, stage, terminal, hasPrescription: rx, seller, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((result) => {
        if (!alive) return;
        setData(result); setError("");
        if (linked && debounced === linked) {
          const hit = (result?.orders ?? []).find((o) => o.id === linked || `#${o.display_id}` === linked);
          if (hit) setOpenId(hit.id);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.status === 401 ? t("adm.err.sessionExpired") : stageErrorText(t, e, "adm.err.orders.loadFailed"));
        if (e.status === 401) setData(null);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [debounced, from, to, stage, terminal, rx, seller, page, reloadKey]);

  function applyPreset(key) { setPreset(key); setFrom(presetFrom(key)); setTo(""); }

  const orders = data?.orders ?? [];
  const count = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasFilters = stage || terminal || rx || seller || debounced || preset === "custom";

  async function move(order, target, opts) {
    setBusyId(order.id);
    try {
      const updated = await setOrderStage(order.id, target, opts);
      const reached = STAGE_BY_KEY[updated?.stage ?? target];
      toast({ tone: "success", title: t("adm.ord.moved", { order: orderLabel(order), stage: reached ? t(reached.label) : target }), message: updated?.__notified ? t("adm.ord.notified") : undefined });
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ tone: "error", title: stageErrorText(t, e), duration: 8000 });
    } finally { setBusyId(null); }
  }

  // Un pedido editado (guía/nota) se repinta en sitio: el servidor devolvió la verdad.
  const patch = (o) => { if (o) setData((d) => d ? { ...d, orders: d.orders.map((x) => (x.id === o.id ? o : x)) } : d); };

  const exportCsv = () => {
    const stageText = (o) => o.terminal && o.terminal !== "payment_pending" ? t(TERMINAL_BY_KEY[o.terminal].label) : t(STAGE_BY_KEY[o.stage]?.label || o.stage);
    const csv = ordersToCsv(orders, [
      [t("adm.col.order"), (o) => orderLabel(o)], [t("adm.col.date"), (o) => shortDate(o.created_at, lang)],
      [t("adm.ord.colCustomer"), (o) => o.customer.name || ""], [t("adm.login.email"), (o) => o.customer.email || ""], [t("adm.sel.phone"), (o) => o.customer.phone || ""],
      [t("adm.ord.colDelivery"), (o) => o.shipping_address?.city || t("adm.ord.pickup")], [t("adm.col.total"), (o) => Number(o.total || 0).toFixed(2)],
      [t("adm.ord.colStage"), stageText], [t("adm.ord.tracking"), (o) => o.tracking_number || ""], [t("adm.ord.seller"), (o) => o.seller_code || ""],
      [t("adm.col.items"), (o) => o.items.map((i) => `${i.quantity}× ${i.title}`).join(" | ")], [t("adm.ord.note"), (o) => o.owner_note || ""],
    ]);
    downloadText(`pedidos-${ymd(Date.now())}.csv`, csv);
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.ord.title")}</h2>
        <div className="adm-orders-tools">
          <label className="adm-find compact" title={t("adm.ord.searchTitle")}>
            <Icon name="search" size={15} />
            <input placeholder={t("adm.ord.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <button type="button" className="adm-find-x" title={t("adm.ord.clear")} onClick={() => setQuery("")}><Icon name="close" size={12} /></button>}
          </label>
          <div className="adm-range">
            {DATE_PRESETS.map((k) => <button key={k} className={preset === k ? "on" : ""} onClick={() => applyPreset(k)}>{t(`adm.ord.preset.${k}`)}</button>)}
          </div>
          <button className="btn-sm" onClick={exportCsv} disabled={!orders.length} title={t("adm.ord.exportTitle")}><Icon name="excel" size={14} />CSV</button>
          <button className="btn-sm" onClick={() => printElement(tableRef.current, t("adm.ord.title"))} disabled={!orders.length} title={t("adm.ui.pdf")}><Icon name="printer" size={14} />PDF</button>
          <button className="btn-sm ghost" onClick={() => setReloadKey((k) => k + 1)} title={t("adm.sec.refresh")}><Icon name="refresh" size={15} /></button>
        </div>
      </div>

      <div className="adm-orders-filters">
        <label>{t("adm.ord.from")}<input type="date" className="adm-sel" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} /></label>
        <label>{t("adm.ord.to")}<input type="date" className="adm-sel" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} /></label>
        <label>{t("adm.ord.stage")}
          <select className="adm-sel" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">{t("adm.ord.allF")}</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
          </select>
        </label>
        <label>{t("adm.ord.state")}
          <select className="adm-sel" value={terminal} onChange={(e) => setTerminal(e.target.value)}>
            <option value="">{t("adm.ord.allM")}</option>
            {TERMINALS.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
          </select>
        </label>
        <label>{t("adm.ord.kind")}
          <select className="adm-sel" value={rx} onChange={(e) => setRx(e.target.value)}>
            <option value="">{t("adm.ord.allM")}</option>
            <option value="true">{t("adm.ord.withRx")}</option>
            <option value="false">{t("adm.ord.withoutRx")}</option>
          </select>
        </label>
        <label>{t("adm.ord.seller")}
          <select className="adm-sel" value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="">{t("adm.ord.allM")}</option>
            <option value="none">{t("adm.ord.noSeller")}</option>
            {sellers.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
          </select>
        </label>
        {hasFilters && (
          <button className="btn-sm ghost" onClick={() => { setStage(""); setTerminal(""); setRx(""); setSeller(""); setQuery(""); applyPreset("30d"); }}><Icon name="close" size={14} />{t("adm.ord.clearFilters")}</button>
        )}
      </div>

      {error && <div className="adm-login-err">{error}</div>}
      {data?.truncated && <div className="adm-find-note muted">{t("adm.ord.truncated", { n: data.scan_limit })}</div>}

      <div className="adm-card" ref={tableRef}>
        <div className="adm-table-wrap">
          <table className="adm-table orders responsive">
            <thead>
              <tr>
                <th>{t("adm.col.order")}</th><th>{t("adm.col.date")}</th><th>{t("adm.ord.colCustomer")}</th><th>{t("adm.ord.colDelivery")}</th>
                <th className="r">{t("adm.col.total")}</th><th>{t("adm.ord.colStage")}</th><th>{t("adm.ord.colAdvance")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !orders.length ? (
                <tr><td colSpan="7" className="full"><div className="adm-skel-rows"><div className="adm-skel" /><div className="adm-skel" /><div className="adm-skel" /></div></td></tr>
              ) : error && !orders.length ? (
                <tr><td colSpan="7" className="muted full">{t("adm.ord.loadFailed")}</td></tr>
              ) : !orders.length ? (
                <tr><td colSpan="7" className="full"><div className="adm-empty"><Icon name="orders" size={36} /><b>{hasFilters ? t("adm.ord.noResults") : t("adm.ord.noneInRange")}</b><p>{t("adm.ord.emptyHint")}</p></div></td></tr>
              ) : orders.map((o) => {
                const open = openId === o.id;
                return [
                  <tr key={o.id} className={`ord-row ${open ? "open" : ""}`} onClick={() => setOpenId(open ? null : o.id)}>
                    <td data-label={t("adm.col.order")}>
                      <b>{orderLabel(o)}</b>
                      {o.has_prescription && <span className="ord-rx" title={t("adm.ord.rxTitle")}><Icon name="glasses" size={13} /></span>}
                      {o.has_tryon && <span className="ord-tryon" title={t("adm.ord.tryonTitle")}><Icon name="camera" size={13} /></span>}
                      {o.owner_note && <span className="ord-tryon" title={o.owner_note}><Icon name="clipboard" size={13} /></span>}
                    </td>
                    <td data-label={t("adm.col.date")}>{shortDate(o.created_at, lang)}</td>
                    <td data-label={t("adm.ord.colCustomer")}><span title={o.customer.email || ""}>{o.customer.name || o.customer.email || "—"}</span>{o.seller_code && <span className="adm-chip gold" style={{ marginLeft: 6, fontSize: 10.5 }}>{o.seller_code}</span>}</td>
                    <td data-label={t("adm.ord.colDelivery")}>{o.shipping_address?.city ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="truck" size={13} />{o.shipping_address.city}</span> : <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="store" size={13} />{t("adm.ord.pickup")}</span>}</td>
                    <td data-label={t("adm.col.total")} className="r num">{fmtMoney(o.total, o.currency_code, lang)}</td>
                    <td data-label={t("adm.ord.colStage")}><StageBadge order={o} /></td>
                    <td data-label={t("adm.ord.colAdvance")}><StageControl order={o} busy={busyId === o.id} onMove={(target, opts) => move(o, target, opts)} /></td>
                  </tr>,
                  open && (
                    <tr key={o.id + "-d"} className="ord-detail">
                      <td colSpan="7" className="full"><OrderDetail order={o} onPatched={patch} onGoCosts={onGoCosts} onMove={(target, opts) => move(o, target, opts)} /></td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>

        <div className="adm-pager">
          <span className="muted">
            {count === 0 ? t("adm.ord.pagerEmpty") : t("adm.ord.pagerRange", { first: page * PAGE_SIZE + 1, last: Math.min((page + 1) * PAGE_SIZE, count), total: int(count) })}
            {loading && orders.length ? t("adm.ord.updating") : ""}
          </span>
          <div>
            <button className="btn-sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>{t("adm.ord.prev")}</button>
            <span className="adm-pager-n">{page + 1} / {pages}</span>
            <button className="btn-sm" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>{t("adm.ord.next")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * `?tab=` en la URL: los enlaces de la hoja de Google abren la sección directa.
 * Las pestañas antiguas (overview/sales/prices) siguen funcionando: ahora viven
 * dentro de Ejecutivo y de Costos y precios.
 */
const LEGACY_TABS = { overview: ["exec", { sub: "overview" }], sales: ["exec", { sub: "detail" }], prices: ["costs", { sub: "prices" }] };
function navFromUrl(tabs) {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const want = q.get("tab") || "";
  if (LEGACY_TABS[want]) return { tab: LEGACY_TABS[want][0], params: { ...LEGACY_TABS[want][1] }, n: 0 };
  const params = {};
  for (const k of ["sub", "order", "stage", "seller", "q", "approval"]) if (q.get(k)) params[k] = q.get(k);
  // El panel abre en el Ejecutivo para quien lo tiene; el resto, en su caja.
  return { tab: tabs.includes(want) ? want : tabs.includes("exec") ? "exec" : tabs[0], params, n: 0 };
}

export default function AdminDashboard({ user, onLogout, me = null }) {
  const { t } = useLang();
  const groups = navGroupsFor(me);
  const tabs = tabsOf(groups);
  const restricted = me?.is_admin === false;
  // `nav.n` cambia en cada salto para que la pantalla destino se monte con los
  // parámetros nuevos (p. ej. Pedidos filtrado por etapa desde el Ejecutivo).
  const [nav, setNav] = useState(() => navFromUrl(tabs));
  const [preset, setPreset] = useState("30d");
  const [find, setFind] = useState("");
  const [sellers, setSellers] = useState([]);
  const demo = isDemoLogin();
  useEffect(() => { if (demo) ensureSeed(); }, [demo]);
  const loadSellers = () => { if (demo || restricted) return; fetchSellers().then((r) => setSellers(r?.sellers ?? [])).catch(() => {}); };
  useEffect(loadSellers, [demo]);

  /** Salto a cualquier pantalla con parámetros: la base de "todo es clicable". */
  const go = (tab, params = {}) => {
    const wanted = LEGACY_TABS[tab] ? LEGACY_TABS[tab][0] : tab;
    const target = tabs.includes(wanted) ? wanted : tabs[0];
    const p = LEGACY_TABS[tab] ? { ...LEGACY_TABS[tab][1], ...params } : params;
    setNav((n) => ({ tab: target, params: p, n: n.n + 1 }));
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      [...u.searchParams.keys()].forEach((k) => u.searchParams.delete(k));
      u.searchParams.set("tab", target);
      if (p.sub) u.searchParams.set("sub", p.sub);
      window.history.replaceState({}, "", u.toString());
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  // El rol llega después del primer pintado: una pestaña que ya no le toca cae en la primera suya.
  const tab = tabs.includes(nav.tab) ? nav.tab : tabs.includes("exec") ? "exec" : tabs[0];
  const onFind = (v) => { setFind(v); if (v && tab !== "costs") go("costs", { sub: "prices" }); };
  const onSub = (sub) => setNav((n) => ({ ...n, params: { ...n.params, sub } }));

  return (
    <AdminShell tab={tab} onTab={(k) => go(k)} user={user} onLogout={onLogout} find={restricted ? null : find} onFind={onFind} groups={groups}>
      {tab === "exec" && (
        <ExecutiveHub preset={preset} setPreset={setPreset} go={go} sub={nav.params.sub} onSub={onSub}
          views={{ overview: <Overview preset={preset} setPreset={setPreset} go={go} />, sales: <Sales preset={preset} setPreset={setPreset} go={go} /> }} />
      )}
      {tab === "orders" && <Orders key={`orders-${nav.n}`} onGoCosts={(id) => go("costs", { sub: "profit", order: id })} sellers={sellers} params={nav.params} />}
      {tab === "costs" && <Costs key={`costs-${nav.n}`} params={nav.params} sellers={sellers} go={go} onSub={onSub} pricesView={<Prices preQ={find || nav.params.q || ""} />} />}
      {tab === "sellers" && <Sellers onChanged={loadSellers} go={go} />}
      {tab === "products" && (
        <>
          <div className="adm-section adm-section-top"><CatalogManager /></div>
          <Products preset={preset} setPreset={setPreset} />
        </>
      )}
      {tab === "stores" && <Stores />}
      {tab === "team" && <Team />}
      {tab === "security" && <Security />}
      {tab === "audit" && <AuditLog />}
      {tab === "pos" && <PosSale me={me} />}
      {tab === "possales" && <PosSales />}
      {tab === "approvals" && <PosApprovals params={nav.params} />}
      {tab === "posconfig" && <PosConfig />}
      {tab === "alerts" && <AlertRules />}
      {tab === "profile" && (
        <div className="adm-section">
          <div className="adm-head-row"><h2>{t("adm.tab.profile")}</h2></div>
          <div className="adm-card"><StaffProfile mode="self" /></div>
        </div>
      )}
      <p className="muted adm-foot">{t("adm.footer", { name: TENANT.name })}</p>
    </AdminShell>
  );
}
