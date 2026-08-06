import { useState, useEffect, useMemo, useSyncExternalStore, useRef } from "react";
import { KpiCard, LineChart, BarChart, DonutChart, Funnel, AccessVsBuyChart, WeekdayChart } from "./charts.jsx";
import { ensureSeed, summarize, rangeFor, subscribe as onAnalytics, clearDemo, productSales } from "./analytics.js";
// The Orders tab is the one part of this panel backed by the real store: it
// reads and mutates Medusa orders instead of the seeded localStorage the other
// tabs still use. `money` is aliased because this file already has its own,
// which assumes dollars and knows nothing about an order's currency.
import {
  STAGES, STAGE_BY_KEY, TERMINALS, TERMINAL_BY_KEY,
  fetchOrders, setOrderStage, orderLabel, stageErrorText,
  money as fmtMoney, shortDate,
} from "./adminOrders.js";
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

/* ---------------- Overview ---------------- */
function Overview({ preset, setPreset }) {
  const { t } = useLang();
  const s = useSummary(preset);
  const k = s.kpis;
  const { products } = useCatalog();
  const imgByName = useMemo(() => Object.fromEntries(products.map((p) => [p.name, p.colors?.[0]?.image])), [products]);
  // summarize() hands back dictionary keys for the labels it invents (weekdays,
  // funnel steps). Resolve them here, at the boundary, so the chart components
  // stay generic and just render whatever label they are given.
  const funnel = useMemo(() => s.funnel.map((f) => ({ ...f, label: t(f.label) })), [s.funnel, t]);
  const weekday = useMemo(() => s.weekday.map((w) => ({ ...w, label: t(w.label) })), [s.weekday, t]);
  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.tab.overview")}</h2>
        <RangePicker value={preset} onChange={setPreset} />
      </div>
      {s.hasDemo && (
        <div className="adm-demo-banner">
          <span dangerouslySetInnerHTML={{ __html: t("adm.demoBanner") }} />{" "}
          <button onClick={clearDemo}>{t("adm.clearDemo")}</button>
        </div>
      )}
      <div className="adm-kpis">
        <KpiCard label={t("adm.kpi.revenue")} value={money(k.revenue)} icon="💵" sub={t("adm.kpi.unitsSub", { n: int(k.units) })} />
        <KpiCard label={t("adm.kpi.orders")} value={int(k.ordersCount)} icon="🧾" />
        <KpiCard label={t("adm.kpi.aov")} value={money(k.aov)} icon="📈" />
        <KpiCard label={t("adm.kpi.access")} value={int(k.access)} icon="👣" />
        <KpiCard label={t("adm.kpi.conversion")} value={(k.conv || 0).toFixed(1) + "%"} icon="🎯" sub={t("adm.kpi.convSub")} />
      </div>
      <div className="adm-grid-2">
        <div className="adm-card"><h3>{t("adm.chart.salesByDay")}</h3><LineChart data={s.salesSeries} valuePrefix="$" color="#0E5AD0" /></div>
        <div className="adm-card"><h3>{t("adm.chart.funnel")}</h3><Funnel steps={funnel} /></div>
      </div>
      <div className="adm-grid-2">
        <div className="adm-card"><h3>{t("adm.chart.salesByBrand")}</h3><DonutChart data={s.topBrands} iconByLabel={BRAND_LOGO_BY_NAME} /></div>
        <div className="adm-card"><h3>{t("adm.chart.topProducts")}</h3><ThumbBars data={s.topProducts} imgByName={imgByName} valuePrefix="$" emptyMsg={t("adm.chart.noSales")} /></div>
      </div>
      <div className="adm-card"><h3>{t("adm.chart.accessVsBuy")}</h3><p className="adm-sub">{t("adm.chart.accessVsBuySub")}</p><AccessVsBuyChart data={s.accessVsBuy} /></div>
      <div className="adm-card"><h3>{t("adm.chart.weekday")}</h3><p className="adm-sub">{t("adm.chart.weekdaySub")}</p><WeekdayChart data={weekday} /></div>
    </div>
  );
}

/* ---------------- Sales ---------------- */
function Sales({ preset, setPreset }) {
  const { t, lang } = useLang();
  const s = useSummary(preset);
  const recent = s.orders.slice(0, 40);
  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>{t("adm.tab.sales")}</h2><RangePicker value={preset} onChange={setPreset} /></div>
      <div className="adm-kpis">
        <KpiCard label={t("adm.kpi.revenue")} value={money(s.kpis.revenue)} icon="💵" />
        <KpiCard label={t("adm.kpi.orders")} value={int(s.kpis.ordersCount)} icon="🧾" />
        <KpiCard label={t("adm.kpi.aov")} value={money(s.kpis.aov)} icon="📈" />
        <KpiCard label={t("adm.kpi.units")} value={int(s.kpis.units)} icon="📦" />
      </div>
      <div className="adm-grid-2">
        <div className="adm-card"><h3>{t("adm.sales.revByDay")}</h3><LineChart data={s.salesSeries} valuePrefix="$" /></div>
        <div className="adm-card"><h3>{t("adm.sales.ordersByDay")}</h3><BarChart data={s.ordersSeries} color="#FD0E3F" /></div>
      </div>
      <div className="adm-card">
        <h3>{t("adm.sales.recent", { n: int(s.orders.length) })}</h3>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>{t("adm.col.order")}</th><th>{t("adm.col.date")}</th><th>{t("adm.col.items")}</th><th className="r">{t("adm.col.total")}</th></tr></thead>
            <tbody>
              {recent.length === 0 ? <tr><td colSpan="4" className="muted">{t("adm.sales.noneInRange")}</td></tr> :
                recent.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}{o.demo && <span className="tag-demo">{t("adm.demoTag")}</span>}</td>
                    <td>{shortDate(o.t, lang)}</td>
                    <td>{o.items.map((i) => i.name).slice(0, 3).join(", ")}{o.items.length > 3 ? "…" : ""}</td>
                    <td className="r">{money(o.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
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
        <KpiCard label={t("adm.prod.frames")} value={int(products.length)} icon="🕶️" />
        <KpiCard label={t("adm.prod.cases")} value={int(cases.length)} icon="📦" />
        <KpiCard label={t("adm.prod.added")} value={int(added.length)} icon="🆕" deltaGood />
        <KpiCard label={t("adm.prod.removed")} value={int(removed.length)} icon="🚫" />
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
          <div className="ship-h"><span>🏬</span> {t("adm.ship.pickup")}
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
          <div className="ship-h"><span>📦</span> {t("adm.ship.origin")}</div>
          <div className="ship-fields">
            <label>{t("adm.ship.name")}<TxtInput value={og.name} onCommit={(v) => PS.setOrigin({ name: v })} wide /></label>
            <label>{t("adm.ship.address")}<TxtInput value={og.address} onCommit={(v) => PS.setOrigin({ address: v })} wide /></label>
            <label>{t("adm.ship.city")}<TxtInput value={og.city} onCommit={(v) => PS.setOrigin({ city: v })} wide /></label>
          </div>
          <div className="ship-h" style={{ marginTop: 12 }}><span>💵</span> {t("adm.ship.baseCost")}</div>
          <div className="ship-fields r3">
            <label>{t("adm.ship.standard")}<PriceInput value={sh.standard} placeholder="4.95" onCommit={(v) => PS.setShipping({ standard: Number(v) || 0 })} /></label>
            <label>{t("adm.ship.express")}<PriceInput value={sh.express} placeholder="12.95" onCommit={(v) => PS.setShipping({ express: Number(v) || 0 })} /></label>
            <label>{t("adm.ship.freeFrom")}<PriceInput value={sh.freeThreshold} placeholder="59" onCommit={(v) => PS.setShipping({ freeThreshold: Number(v) || 0 })} /></label>
          </div>
        </div>
      </div>
      <div className="ship-h" style={{ marginTop: 14 }}><span>🌎</span> {t("adm.ship.zones")}
        <button className="btn-sm" onClick={PS.addZone}>{t("adm.ship.addZone")}</button></div>
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
                <td><button className="btn-sm danger" title={t("adm.ship.removeZone")} onClick={() => PS.removeZone(z.id)}>✕</button></td>
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
  const sales = useMemo(() => productSales(), []);

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
            : <span className="pp-tag sold">🛒 {m} <em>{t("adm.prices.thisMonth")}</em></span>}
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
          <button className="btn-sm" onClick={PS.exportJSON}>{t("adm.prices.export")}</button>
          <button className="btn-sm" onClick={() => fileRef.current?.click()}>{t("adm.prices.import")}</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={doImport} />
          <button className="btn-sm danger" onClick={doReset}>{t("adm.prices.reset")}</button>
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
 */

const PAGE_SIZE = 20;

/**
 * Quick ranges. They resolve to an absolute `from` date immediately rather than
 * being sent as "30d", so the server never has to guess which clock the window
 * was measured against — and so the date inputs below can show what a preset
 * actually selected.
 */
const DATE_PRESETS = [
  ["all", "Todo"],
  ["7d", "7 días"],
  ["30d", "30 días"],
  ["90d", "90 días"],
];

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function presetFrom(preset) {
  const days = { "7d": 7, "30d": 30, "90d": 90 }[preset];
  return days ? ymd(Date.now() - days * 864e5) : "";
}

/** Coloured pill for the stage, or for the terminal state that replaced it. */
function StageBadge({ order }) {
  const { t } = useLang();
  const term = order.terminal && TERMINAL_BY_KEY[order.terminal];
  // A canceled or refunded order is not "somewhere on the timeline" — showing a
  // stage for it would be a lie, exactly as TrackingTimeline decides.
  if (term && order.terminal !== "payment_pending") {
    return <span className="ord-badge" style={{ background: term.bg, color: term.color }}>{term.icon} {t(term.label)}</span>;
  }
  const st = STAGE_BY_KEY[order.stage] || STAGE_BY_KEY.confirmed;
  return (
    <span className="ord-badge" style={{ background: st.bg, color: st.color }}>
      {st.icon} {t(st.label)}
      {term && <span className="ord-badge-sub" title={t("adm.ord.paymentPending")}> · ⏳</span>}
    </span>
  );
}

/**
 * The "advance" control.
 *
 * Only `order.next_stages` is offered. Moving to `in_transit` asks for the
 * courier reference first, because that number is what the customer's tracking
 * page renders — collecting it after the fact means an email that says "on its
 * way" with nothing to track.
 */
function StageControl({ order, busy, onMove }) {
  const { t } = useLang();
  const [asking, setAsking] = useState(null);
  const [tracking, setTracking] = useState("");
  const next = order.next_stages || [];

  if (!next.length) {
    return <span className="muted ord-nomove">{t("adm.ord.noMoves")}</span>;
  }

  if (asking) {
    return (
      <form
        className="ord-track-form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onMove(asking, { trackingNumber: tracking.trim() });
          setAsking(null);
          setTracking("");
        }}
      >
        <input
          autoFocus
          placeholder={t("adm.ord.trackingPh")}
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
        />
        <button className="btn-sm primary" disabled={busy}>{t("adm.ord.confirm")}</button>
        <button type="button" className="btn-sm" onClick={() => { setAsking(null); setTracking(""); }}>{t("adm.ord.cancel")}</button>
      </form>
    );
  }

  return (
    <div className="ord-moves" onClick={(e) => e.stopPropagation()}>
      {next.map((key) => {
        const st = STAGE_BY_KEY[key];
        return (
          <button
            key={key}
            className="btn-sm ord-move"
            disabled={busy}
            title={t(st.action)}
            onClick={() => (key === "in_transit" ? setAsking(key) : onMove(key, {}))}
          >
            {st.icon} {t(st.label)}
          </button>
        );
      })}
    </div>
  );
}

function OrderDetail({ order }) {
  const { t, lang } = useLang();
  const addr = order.shipping_address;
  return (
    <div className="ord-detail-grid">
      <div>
        <b>{t("adm.ord.itemsTitle")}</b>
        <ul>
          {order.items.map((it) => (
            <li key={it.id}>
              <span>
                {it.quantity > 1 && <em className="ord-qty">{it.quantity}× </em>}
                {it.title}
                {it.has_prescription && <span className="ord-rx" title={t("adm.ord.rxTitle")}>{t("adm.ord.rx")}</span>}
              </span>
              <b>{fmtMoney(it.total, order.currency_code, lang)}</b>
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
      </div>
      <div>
        <b>{addr ? t("adm.ord.deliveryTitle") : t("adm.ord.pickupTitle")}</b>
        {addr ? (
          <p className="ord-addr">
            📍 {[addr.address_1, addr.address_2].filter(Boolean).join(", ")}
            {addr.city ? `, ${addr.city}` : ""}
            {addr.postal_code ? ` (${addr.postal_code})` : ""}
            <br />
            👤 {order.customer.name || "—"}
            {order.customer.phone ? ` · 📞 ${order.customer.phone}` : ""}
            <br />
            ✉️ {order.customer.email || "—"}
            {order.shipping_method ? ` · 🏷️ ${order.shipping_method}` : ""}
          </p>
        ) : (
          <p className="ord-addr muted">{t("adm.ord.noAddress")}</p>
        )}
        {order.tracking_number && (
          <p className="ord-addr">{t("adm.ord.tracking")} <b>{order.tracking_number}</b></p>
        )}
        {order.lab_stage && (
          <p className="ord-addr muted">
            {t("adm.ord.labPinned", { stage: t(STAGE_BY_KEY[order.lab_stage]?.label ?? order.lab_stage) })}
          </p>
        )}
      </div>
    </div>
  );
}

function Orders() {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // `preset` only drives which quick-range button looks active; `from`/`to` are
  // the single source of truth for what gets requested.
  const [preset, setPreset] = useState("30d");
  const [from, setFrom] = useState(() => presetFrom("30d"));
  const [to, setTo] = useState("");
  const [stage, setStage] = useState("");
  const [terminal, setTerminal] = useState("");
  const [rx, setRx] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Bumped after a transition so the effect re-runs without duplicating its body.
  const [reloadKey, setReloadKey] = useState(0);

  // Typing shouldn't fire a request per keystroke against a route that reads
  // hundreds of orders with all their relations.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  // Any change to the filters invalidates the page number — staying on page 4
  // of a result set that now has one page shows an empty table.
  useEffect(() => { setPage(0); }, [debounced, from, to, stage, terminal, rx]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchOrders({
      q: debounced,
      from,
      to,
      stage,
      terminal,
      hasPrescription: rx,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError("");
      })
      .catch((e) => {
        if (!alive) return;
        setError(
          e.status === 401
            ? t("adm.err.sessionExpired")
            : stageErrorText(t, e, "adm.err.orders.loadFailed")
        );
        // Drop the rows too: leaving the previous page on screen behind an error
        // banner offers "avanzar" buttons that are already going to fail, and
        // makes a dead session look like a working one.
        if (e.status === 401) setData(null);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [debounced, from, to, stage, terminal, rx, page, reloadKey]);

  function applyPreset(key) {
    setPreset(key);
    setFrom(presetFrom(key));
    setTo("");
  }

  const orders = data?.orders ?? [];
  const count = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  async function move(order, target, opts) {
    setBusyId(order.id);
    try {
      const updated = await setOrderStage(order.id, target, opts);
      const reached = STAGE_BY_KEY[updated?.stage ?? target];
      toast({
        tone: "success",
        title: t("adm.ord.moved", {
          order: orderLabel(order),
          stage: reached ? t(reached.label) : target,
        }),
      });
      // Re-read the page rather than patching the row: a transition can change
      // the order's stage AND drop it out of the current filter, and only the
      // server knows which.
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ tone: "error", title: stageErrorText(t, e), duration: 8000 });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.ord.title")}</h2>
        <div className="adm-orders-tools">
          <div className="adm-find compact" title={t("adm.ord.searchTitle")}>
            <span aria-hidden="true">🔎</span>
            <input
              placeholder={t("adm.ord.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && <button className="adm-find-x" title={t("adm.ord.clear")} onClick={() => setQuery("")}>×</button>}
          </div>
          <div className="adm-range">
            {DATE_PRESETS.map(([k, l]) => (
              <button key={k} className={preset === k ? "on" : ""} onClick={() => applyPreset(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="adm-orders-filters">
        <label>
          {t("adm.ord.from")}
          <input
            type="date"
            className="adm-sel"
            value={from}
            max={to || undefined}
            onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
          />
        </label>
        <label>
          {t("adm.ord.to")}
          <input
            type="date"
            className="adm-sel"
            value={to}
            min={from || undefined}
            onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
          />
        </label>
        <label>
          {t("adm.ord.stage")}
          <select className="adm-sel" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">{t("adm.ord.allF")}</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.icon} {t(s.label)}</option>)}
          </select>
        </label>
        <label>
          {t("adm.ord.state")}
          <select className="adm-sel" value={terminal} onChange={(e) => setTerminal(e.target.value)}>
            <option value="">{t("adm.ord.allM")}</option>
            {TERMINALS.map((s) => <option key={s.key} value={s.key}>{s.icon} {t(s.label)}</option>)}
          </select>
        </label>
        <label>
          {t("adm.ord.kind")}
          <select className="adm-sel" value={rx} onChange={(e) => setRx(e.target.value)}>
            <option value="">{t("adm.ord.allM")}</option>
            <option value="true">{t("adm.ord.withRx")}</option>
            <option value="false">{t("adm.ord.withoutRx")}</option>
          </select>
        </label>
        {(stage || terminal || rx || debounced || preset === "custom") && (
          <button
            className="btn-sm"
            onClick={() => { setStage(""); setTerminal(""); setRx(""); setQuery(""); applyPreset("30d"); }}
          >
            {t("adm.ord.clearFilters")}
          </button>
        )}
      </div>

      {error && <div className="adm-login-err">{error}</div>}

      {data?.truncated && (
        <div className="adm-find-note muted">
          {t("adm.ord.truncated", { n: data.scan_limit })}
        </div>
      )}

      <div className="adm-card">
        <div className="adm-table-wrap">
          <table className="adm-table orders">
            <thead>
              <tr>
                <th>{t("adm.col.order")}</th><th>{t("adm.col.date")}</th><th>{t("adm.ord.colCustomer")}</th><th>{t("adm.ord.colDelivery")}</th>
                <th className="r">{t("adm.col.total")}</th><th>{t("adm.ord.colStage")}</th><th>{t("adm.ord.colAdvance")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !orders.length ? (
                <tr><td colSpan="7" className="muted">{t("adm.ord.loading")}</td></tr>
              ) : error && !orders.length ? (
                // Never say "no orders" when the truth is "we could not ask".
                <tr><td colSpan="7" className="muted">{t("adm.ord.loadFailed")}</td></tr>
              ) : !orders.length ? (
                <tr><td colSpan="7" className="muted">
                  {debounced || stage || terminal || rx ? t("adm.ord.noResults") : t("adm.ord.noneInRange")}
                </td></tr>
              ) : orders.map((o) => {
                const open = openId === o.id;
                return [
                  <tr key={o.id} className="ord-row" onClick={() => setOpenId(open ? null : o.id)}>
                    <td>
                      <b>{orderLabel(o)}</b>
                      {o.has_prescription && <span className="ord-rx" title={t("adm.ord.rxTitle")}>👓</span>}
                    </td>
                    <td>{shortDate(o.created_at, lang)}</td>
                    <td><span title={o.customer.email || ""}>{o.customer.name || o.customer.email || "—"}</span></td>
                    <td>{o.shipping_address?.city ? `🚚 ${o.shipping_address.city}` : t("adm.ord.pickup")}</td>
                    <td className="r">{fmtMoney(o.total, o.currency_code, lang)}</td>
                    <td><StageBadge order={o} /></td>
                    <td>
                      <StageControl
                        order={o}
                        busy={busyId === o.id}
                        onMove={(target, opts) => move(o, target, opts)}
                      />
                    </td>
                  </tr>,
                  open && (
                    <tr key={o.id + "-d"} className="ord-detail">
                      <td colSpan="7"><OrderDetail order={o} /></td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>

        <div className="adm-pager">
          <span className="muted">
            {count === 0
              ? t("adm.ord.pagerEmpty")
              : t("adm.ord.pagerRange", {
                  first: page * PAGE_SIZE + 1,
                  last: Math.min((page + 1) * PAGE_SIZE, count),
                  total: int(count),
                })}
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

const TABS = ["overview", "sales", "orders", "products", "prices"];

export default function AdminDashboard() {
  const { t } = useLang();
  const [tab, setTab] = useState("overview");
  const [preset, setPreset] = useState("30d");
  const [find, setFind] = useState("");
  useEffect(() => { ensureSeed(); }, []);
  const onFind = (v) => { setFind(v); if (v) setTab("prices"); };
  return (
    <div className="adm-body">
      <div className="adm-navbar">
        <nav className="adm-tabs">
          {TABS.map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`adm.tab.${k}`)}</button>)}
        </nav>
        <div className="adm-find" title={t("adm.findPriceTitle")}>
          <span aria-hidden="true">🔎</span>
          <input placeholder={t("adm.findPrice")} value={find} onChange={(e) => onFind(e.target.value)} />
        </div>
      </div>
      {tab === "overview" && <Overview preset={preset} setPreset={setPreset} />}
      {tab === "sales" && <Sales preset={preset} setPreset={setPreset} />}
      {tab === "orders" && <Orders />}
      {tab === "products" && <Products preset={preset} setPreset={setPreset} />}
      {tab === "prices" && <Prices preQ={find} />}
    </div>
  );
}
