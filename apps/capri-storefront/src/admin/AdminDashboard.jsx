import { useState, useEffect, useMemo, useSyncExternalStore, useRef } from "react";
import { KpiCard, LineChart, BarChart, DonutChart, Funnel, AccessVsBuyChart, WeekdayChart } from "./charts.jsx";
import { ensureSeed, summarize, rangeFor, subscribe as onAnalytics, clearDemo, productSales } from "./analytics.js";
// The Orders tab is the one part of this panel backed by the real store: it
// reads and mutates Medusa orders instead of the seeded localStorage the other
// tabs still use. `money` is aliased because this file already has its own,
// which assumes dollars and knows nothing about an order's currency.
import {
  STAGES, STAGE_BY_KEY, TERMINALS, TERMINAL_BY_KEY, STAGE_ACTION,
  fetchOrders, setOrderStage, orderLabel, money as fmtMoney,
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
function ThumbBars({ data, imgByName, valuePrefix = "", emptyMsg = "Sin datos" }) {
  if (!data || !data.length) return <div className="adm-nodata">{emptyMsg}</div>;
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

const RANGES = [
  ["today", "Hoy"], ["7d", "7 días"], ["30d", "30 días"], ["90d", "90 días"], ["ytd", "Año"], ["all", "Todo"],
];

function RangePicker({ value, onChange }) {
  return (
    <div className="adm-range">
      {RANGES.map(([k, label]) => (
        <button key={k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{label}</button>
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
  const s = useSummary(preset);
  const k = s.kpis;
  const { products } = useCatalog();
  const imgByName = useMemo(() => Object.fromEntries(products.map((p) => [p.name, p.colors?.[0]?.image])), [products]);
  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>Resumen</h2>
        <RangePicker value={preset} onChange={setPreset} />
      </div>
      {s.hasDemo && <div className="adm-demo-banner">Mostrando <b>datos demo</b> para ilustrar. Se reemplazan por datos reales a medida que la tienda se usa. <button onClick={clearDemo}>Borrar demo</button></div>}
      <div className="adm-kpis">
        <KpiCard label="Ingresos" value={money(k.revenue)} icon="💵" sub={`${int(k.units)} unidades`} />
        <KpiCard label="Pedidos" value={int(k.ordersCount)} icon="🧾" />
        <KpiCard label="Ticket medio" value={money(k.aov)} icon="📈" />
        <KpiCard label="Accesos" value={int(k.access)} icon="👣" />
        <KpiCard label="Conversión" value={(k.conv || 0).toFixed(1) + "%"} icon="🎯" sub="pedidos / accesos" />
      </div>
      <div className="adm-grid-2">
        <div className="adm-card"><h3>Ventas por día</h3><LineChart data={s.salesSeries} valuePrefix="$" color="#0E5AD0" /></div>
        <div className="adm-card"><h3>Embudo de conversión</h3><Funnel steps={s.funnel} /></div>
      </div>
      <div className="adm-grid-2">
        <div className="adm-card"><h3>Ventas por marca</h3><DonutChart data={s.topBrands} iconByLabel={BRAND_LOGO_BY_NAME} /></div>
        <div className="adm-card"><h3>Top productos (ingresos)</h3><ThumbBars data={s.topProducts} imgByName={imgByName} valuePrefix="$" emptyMsg="Sin ventas aún" /></div>
      </div>
      <div className="adm-card"><h3>Accesos vs Compras por día</h3><p className="adm-sub">Cuánta gente entra y cuánta compra cada día</p><AccessVsBuyChart data={s.accessVsBuy} /></div>
      <div className="adm-card"><h3>Por día de la semana</h3><p className="adm-sub">¿Qué días entran y compran más? (% = conversión)</p><WeekdayChart data={s.weekday} /></div>
    </div>
  );
}

/* ---------------- Sales ---------------- */
function Sales({ preset, setPreset }) {
  const s = useSummary(preset);
  const recent = s.orders.slice(0, 40);
  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>Ventas</h2><RangePicker value={preset} onChange={setPreset} /></div>
      <div className="adm-kpis">
        <KpiCard label="Ingresos" value={money(s.kpis.revenue)} icon="💵" />
        <KpiCard label="Pedidos" value={int(s.kpis.ordersCount)} icon="🧾" />
        <KpiCard label="Ticket medio" value={money(s.kpis.aov)} icon="📈" />
        <KpiCard label="Unidades" value={int(s.kpis.units)} icon="📦" />
      </div>
      <div className="adm-grid-2">
        <div className="adm-card"><h3>Ingresos por día</h3><LineChart data={s.salesSeries} valuePrefix="$" /></div>
        <div className="adm-card"><h3>Pedidos por día</h3><BarChart data={s.ordersSeries} color="#FD0E3F" /></div>
      </div>
      <div className="adm-card">
        <h3>Pedidos recientes ({int(s.orders.length)})</h3>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Pedido</th><th>Fecha</th><th>Artículos</th><th className="r">Total</th></tr></thead>
            <tbody>
              {recent.length === 0 ? <tr><td colSpan="4" className="muted">Sin pedidos en este rango.</td></tr> :
                recent.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}{o.demo && <span className="tag-demo">demo</span>}</td>
                    <td>{new Date(o.t).toLocaleDateString("es")}</td>
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
            <small className="muted">{x.date ? new Date(x.date).toLocaleDateString("es") : "—"}</small>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>Productos</h2><RangePicker value={preset} onChange={setPreset} /></div>
      {!history && <div className="adm-demo-banner">Aún no hay historial diario acumulado (<code>catalog-history.json</code>). Se muestra el último diff del servicio; el historial se llena con cada corrida del sync.</div>}
      <div className="adm-kpis">
        <KpiCard label="Monturas disponibles" value={int(products.length)} icon="🕶️" />
        <KpiCard label="Estuches disponibles" value={int(cases.length)} icon="📦" />
        <KpiCard label="Nuevos (rango)" value={int(added.length)} icon="🆕" deltaGood />
        <KpiCard label="Retirados (rango)" value={int(removed.length)} icon="🚫" />
      </div>
      <div className="adm-grid-2">
        <div className="adm-card">
          <h3>🆕 Productos nuevos</h3>
          <ProdList list={added} empty="Sin altas en este rango." />
        </div>
        <div className="adm-card">
          <h3>🚫 Ya no disponibles</h3>
          <ProdList list={removed} empty="Sin bajas en este rango." />
        </div>
      </div>
      <div className="adm-card">
        <h3>Catálogo por marca</h3>
        <ThumbBars
          data={brandRows.map(([slug, value]) => ({ label: (BRAND_BY_SLUG[slug]?.name) || slug, value }))}
          imgByName={Object.fromEntries(brandRows.map(([slug]) => { const b = BRAND_BY_SLUG[slug]; return [b?.name || slug, b?.logo]; }))}
        />
      </div>
    </div>
  );
}

/* ---------------- Prices ---------------- */
const MATERIALS = [
  ["1.50", "1.50 estándar (CR-39)", 0], ["1.59", "1.59 policarbonato", 20], ["1.61", "1.61 delgado", 35],
  ["1.67", "1.67 ultradelgado", 60], ["1.74", "1.74 extradelgado", 95],
];
const TREATMENTS = [
  ["ar", "Antirreflejo", 8], ["blue", "Filtro luz azul", 20], ["photo", "Fotocromático", 45], ["tint", "Tinte de sol", 15],
];
const USAGE = [
  ["sv-dist", "Visión sencilla (lejos)", 6.95], ["sv-read", "Visión sencilla (lectura)", 6.95],
  ["progressive", "Progresivo", 49], ["frame-only", "Solo montura (sin lentes)", 0],
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
  const sh = ov.shipping; const pk = sh.pickup || {}; const og = sh.origin || {};
  const zones = sh.zones || []; const carriers = sh.carriers || ["FedEx", "UPS", "USPS", "DHL", "Consignataria"];
  return (
    <div className="adm-card">
      <h3>🚚 Envío y recogida</h3>
      <div className="adm-grid-2">
        <div className="ship-block">
          <div className="ship-h"><span>🏬</span> Recogida en tienda
            <label className="ship-toggle"><input type="checkbox" checked={!!pk.enabled} onChange={(e) => PS.setPickup({ enabled: e.target.checked })} /> Activa</label>
          </div>
          <div className="ship-fields">
            <label>🏷️ Nombre<TxtInput value={pk.name} onCommit={(v) => PS.setPickup({ name: v })} wide /></label>
            <label>📍 Dirección<TxtInput value={pk.address} onCommit={(v) => PS.setPickup({ address: v })} wide /></label>
            <label>🏙️ Ciudad<TxtInput value={pk.city} onCommit={(v) => PS.setPickup({ city: v })} wide /></label>
            <label>🕒 Horario<TxtInput value={pk.hours} onCommit={(v) => PS.setPickup({ hours: v })} wide /></label>
            <label>🗺️ Enlace de mapa<TxtInput value={pk.mapsUrl} onCommit={(v) => PS.setPickup({ mapsUrl: v })} wide /></label>
          </div>
        </div>
        <div className="ship-block">
          <div className="ship-h"><span>📦</span> Origen de envío</div>
          <div className="ship-fields">
            <label>🏷️ Nombre<TxtInput value={og.name} onCommit={(v) => PS.setOrigin({ name: v })} wide /></label>
            <label>📍 Dirección<TxtInput value={og.address} onCommit={(v) => PS.setOrigin({ address: v })} wide /></label>
            <label>🏙️ Ciudad<TxtInput value={og.city} onCommit={(v) => PS.setOrigin({ city: v })} wide /></label>
          </div>
          <div className="ship-h" style={{ marginTop: 12 }}><span>💵</span> Envío base ($)</div>
          <div className="ship-fields r3">
            <label>Estándar<PriceInput value={sh.standard} placeholder="4.95" onCommit={(v) => PS.setShipping({ standard: Number(v) || 0 })} /></label>
            <label>Exprés<PriceInput value={sh.express} placeholder="12.95" onCommit={(v) => PS.setShipping({ express: Number(v) || 0 })} /></label>
            <label>Gratis desde<PriceInput value={sh.freeThreshold} placeholder="59" onCommit={(v) => PS.setShipping({ freeThreshold: Number(v) || 0 })} /></label>
          </div>
        </div>
      </div>
      <div className="ship-h" style={{ marginTop: 14 }}><span>🌎</span> Zonas de envío
        <button className="btn-sm" onClick={PS.addZone}>＋ Zona</button></div>
      <div className="adm-table-wrap">
        <table className="adm-table zones">
          <thead><tr><th>🌍 Destino</th><th>🏷️ Transportista</th><th>💵 Costo</th><th>⏱️ Días</th><th></th></tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td><TxtInput value={z.name} onCommit={(v) => PS.updateZone(z.id, { name: v })} wide /></td>
                <td><select className="adm-sel" value={z.carrier} onChange={(e) => PS.updateZone(z.id, { carrier: e.target.value })}>
                  {[...new Set([z.carrier, ...carriers])].filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                <td><PriceInput value={z.cost} onCommit={(v) => PS.updateZone(z.id, { cost: Number(v) || 0 })} /></td>
                <td className="eta"><PriceInput value={z.etaMin} onCommit={(v) => PS.updateZone(z.id, { etaMin: Number(v) || 0 })} /><span>–</span><PriceInput value={z.etaMax} onCommit={(v) => PS.updateZone(z.id, { etaMax: Number(v) || 0 })} /></td>
                <td><button className="btn-sm danger" title="Eliminar zona" onClick={() => PS.removeZone(z.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">💡 El cliente ve estas zonas al elegir «Envío a domicilio» en el carrito, con costo y tiempo estimado. El cálculo real por transportista (FedEx / UPS / DHL / consignataria) se conecta luego al backend.</p>
    </div>
  );
}

// Categories (columns) for the fotocromáticos / transitions table.
const LENS_PHOTO_CATS = [
  ["sv", { es: "Visión Sencilla", en: "Single Vision" }],
  ["bifocal", { es: "Bifocal", en: "Bifocal" }],
  ["prog", { es: "Progresivo", en: "Progressive" }],
];

// "Lista de precios 2026 · Lentes": base matrix + fotocromáticos + antirreflejos.
function LensPriceList() {
  const { lang } = useLang();
  const [, force] = useState(0);
  useEffect(() => PS.subscribe(() => force((n) => n + 1)), []);
  return (
    <div className="adm-card lens-pl">
      <h3>{lang === "en" ? "Price list 2026 · Lenses" : "Lista de precios 2026 · Lentes"}</h3>

      <div className="lens-sub">
        <h4>{lang === "en" ? "Base price (design × material)" : "Precio base (diseño × material)"}</h4>
        <div className="adm-table-wrap">
          <table className="adm-table lens-tbl">
            <thead>
              <tr>
                <th>{lang === "en" ? "Design" : "Diseño"}</th>
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
        <h4>{lang === "en" ? "Photochromic / Transitions ($)" : "Fotocromáticos / Transitions ($)"}</h4>
        <div className="adm-table-wrap">
          <table className="adm-table lens-tbl">
            <thead>
              <tr>
                <th>{lang === "en" ? "Type" : "Tipo"}</th>
                {LENS_PHOTO_CATS.map(([k, lbl]) => <th key={k} className="r">{L(lbl, lang)}</th>)}
              </tr>
            </thead>
            <tbody>
              {PHOTO.map((p) => (
                <tr key={p.id}>
                  <td><b>{L(p.label, lang)}</b></td>
                  {LENS_PHOTO_CATS.map(([cat]) => {
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
        <h4>{lang === "en" ? "Anti-reflective ($)" : "Antirreflejos ($)"}</h4>
        <div className="adm-grid-2">
          <div className="lens-ar-group">
            <div className="lens-ar-h">{lang === "en" ? "For Single Vision" : "Para Visión Sencilla"}</div>
            {AR.sv.map((a) => (
              <div className="adm-price-row" key={a.id}>
                <span>{L(a.label, lang)}</span>
                <PriceInput value={PS.lensARPrice(a.id, a.price)} placeholder={String(a.price)} onCommit={(v) => PS.setLensAR(a.id, v)} />
              </div>
            ))}
          </div>
          <div className="lens-ar-group">
            <div className="lens-ar-h">{lang === "en" ? "For Bifocals & Progressives" : "Para Bifocales y Progresivos"}</div>
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
          <span className="adm-pp-name">{p.name} <small className="muted">{p.brand ? p.brand + " · " : ""}base {money(p.basePrice ?? p.price)}</small></span>
        </div>
        <div className="adm-pp-right">
          {ev === 0
            ? <span className="pp-tag never" title="Este producto nunca se ha vendido">Nunca vendido</span>
            : <span className="pp-tag sold">🛒 {m} <em>este mes</em></span>}
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
        <h2>Precios</h2>
        <div className="adm-actions">
          <button className="btn-sm" onClick={PS.exportJSON}>Exportar JSON</button>
          <button className="btn-sm" onClick={() => fileRef.current?.click()}>Importar</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={doImport} />
          <button className="btn-sm danger" onClick={doReset}>Restablecer</button>
        </div>
      </div>
      <p className="muted">Edita cualquier precio. Vacío = usa el precio base. Los cambios se aplican en la tienda al instante.</p>

      <div className="adm-grid-2">
        <div className="adm-card">
          <h3>Lentes · materiales (recargo $)</h3>
          {MATERIALS.map(([k, label, base]) => (
            <div className="adm-price-row" key={k}><span>{label} <small className="muted">base ${base}</small></span>
              <PriceInput value={ov.materials[k]} placeholder={String(base)} onCommit={(v) => PS.setMaterialPrice(k, v)} /></div>
          ))}
          <h3 style={{ marginTop: 14 }}>Tratamientos (recargo $)</h3>
          {TREATMENTS.map(([k, label, base]) => (
            <div className="adm-price-row" key={k}><span>{label} <small className="muted">base ${base}</small></span>
              <PriceInput value={ov.treatments[k]} placeholder={String(base)} onCommit={(v) => PS.setTreatmentPrice(k, v)} /></div>
          ))}
        </div>
        <div className="adm-card">
          <h3>Tipo de lente / uso ($)</h3>
          {USAGE.map(([k, label, base]) => (
            <div className="adm-price-row" key={k}><span>{label} <small className="muted">base ${base}</small></span>
              <PriceInput value={ov.usage[k]} placeholder={String(base)} onCommit={(v) => PS.setUsagePrice(k, v)} /></div>
          ))}
        </div>
      </div>

      <ShippingConfig ov={ov} />

      <div className="adm-card">
        <h3>Accesorios · estuches ($)</h3>
        <div className="adm-price-grid">
          {cases.map((c) => (
            <ProdRow key={c.slug} p={c} value={ov.cases[c.sku]} onCommit={(v) => PS.setCasePrice(c.sku, v)} />
          ))}
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-head-row"><h3>Monturas ({int(products.length)}) · precio por modelo</h3>
          <input className="adm-search" placeholder="Buscar modelo o marca…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
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
        {products.length > 200 && <p className="muted">Mostrando 200 — usa el buscador para acotar.</p>}
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
  const term = order.terminal && TERMINAL_BY_KEY[order.terminal];
  // A canceled or refunded order is not "somewhere on the timeline" — showing a
  // stage for it would be a lie, exactly as TrackingTimeline decides.
  if (term && order.terminal !== "payment_pending") {
    return <span className="ord-badge" style={{ background: term.bg, color: term.color }}>{term.icon} {term.label}</span>;
  }
  const st = STAGE_BY_KEY[order.stage] || STAGE_BY_KEY.confirmed;
  return (
    <span className="ord-badge" style={{ background: st.bg, color: st.color }}>
      {st.icon} {st.label}
      {term && <span className="ord-badge-sub" title="El pago aún no está confirmado"> · ⏳</span>}
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
  const [asking, setAsking] = useState(null);
  const [tracking, setTracking] = useState("");
  const next = order.next_stages || [];

  if (!next.length) {
    return <span className="muted ord-nomove">Sin cambios disponibles</span>;
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
          placeholder="Nº de seguimiento (opcional)"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
        />
        <button className="btn-sm primary" disabled={busy}>Confirmar</button>
        <button type="button" className="btn-sm" onClick={() => { setAsking(null); setTracking(""); }}>Cancelar</button>
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
            title={STAGE_ACTION[key]}
            onClick={() => (key === "in_transit" ? setAsking(key) : onMove(key, {}))}
          >
            {st.icon} {st.label}
          </button>
        );
      })}
    </div>
  );
}

function OrderDetail({ order }) {
  const addr = order.shipping_address;
  return (
    <div className="ord-detail-grid">
      <div>
        <b>🛍️ Artículos</b>
        <ul>
          {order.items.map((it) => (
            <li key={it.id}>
              <span>
                {it.quantity > 1 && <em className="ord-qty">{it.quantity}× </em>}
                {it.title}
                {it.has_prescription && <span className="ord-rx" title="Lleva receta">👓 receta</span>}
              </span>
              <b>{fmtMoney(it.total, order.currency_code)}</b>
            </li>
          ))}
        </ul>
        <p className="ord-totals muted">
          Artículos {fmtMoney(order.item_total, order.currency_code)}
          {" · "}Envío {fmtMoney(order.shipping_total, order.currency_code)}
          {" · "}Impuestos {fmtMoney(order.tax_total, order.currency_code)}
        </p>
      </div>
      <div>
        <b>{addr ? "🚚 Entrega" : "🏬 Recogida en tienda"}</b>
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
          <p className="ord-addr muted">Sin dirección de envío en este pedido.</p>
        )}
        {order.tracking_number && (
          <p className="ord-addr">📦 Seguimiento: <b>{order.tracking_number}</b></p>
        )}
        {order.lab_stage && (
          <p className="ord-addr muted">🔬 Etapa de laboratorio fijada a mano: {order.lab_stage}</p>
        )}
      </div>
    </div>
  );
}

function Orders() {
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
            ? "Tu sesión caducó. Vuelve a entrar."
            : e.message || "No se pudieron cargar los pedidos."
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
      toast({
        tone: "success",
        title: `${orderLabel(order)} → ${STAGE_BY_KEY[updated?.stage ?? target]?.label ?? target}`,
      });
      // Re-read the page rather than patching the row: a transition can change
      // the order's stage AND drop it out of the current filter, and only the
      // server knows which.
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ tone: "error", title: e.message || "No se pudo actualizar el pedido.", duration: 8000 });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>Pedidos</h2>
        <div className="adm-orders-tools">
          <div className="adm-find compact" title="Buscar por número, cliente, ciudad, correo, teléfono o artículo">
            <span aria-hidden="true">🔎</span>
            <input
              placeholder="Buscar pedido: #, cliente, ciudad, correo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && <button className="adm-find-x" title="Limpiar" onClick={() => setQuery("")}>×</button>}
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
          Desde
          <input
            type="date"
            className="adm-sel"
            value={from}
            max={to || undefined}
            onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            className="adm-sel"
            value={to}
            min={from || undefined}
            onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
          />
        </label>
        <label>
          Etapa
          <select className="adm-sel" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Todas</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
          </select>
        </label>
        <label>
          Estado
          <select className="adm-sel" value={terminal} onChange={(e) => setTerminal(e.target.value)}>
            <option value="">Todos</option>
            {TERMINALS.map((s) => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
          </select>
        </label>
        <label>
          Tipo
          <select className="adm-sel" value={rx} onChange={(e) => setRx(e.target.value)}>
            <option value="">Todos</option>
            <option value="true">👓 Con receta</option>
            <option value="false">🕶️ Sin receta</option>
          </select>
        </label>
        {(stage || terminal || rx || debounced || preset === "custom") && (
          <button
            className="btn-sm"
            onClick={() => { setStage(""); setTerminal(""); setRx(""); setQuery(""); applyPreset("30d"); }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {error && <div className="adm-login-err">{error}</div>}

      {data?.truncated && (
        <div className="adm-find-note muted">
          ⚠️ Mostrando los {data.scan_limit} pedidos más recientes del rango. Acota la fecha para ver pedidos anteriores.
        </div>
      )}

      <div className="adm-card">
        <div className="adm-table-wrap">
          <table className="adm-table orders">
            <thead>
              <tr>
                <th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Entrega</th>
                <th className="r">Total</th><th>Etapa</th><th>Avanzar a</th>
              </tr>
            </thead>
            <tbody>
              {loading && !orders.length ? (
                <tr><td colSpan="7" className="muted">Cargando pedidos…</td></tr>
              ) : error && !orders.length ? (
                // Never say "no orders" when the truth is "we could not ask".
                <tr><td colSpan="7" className="muted">No se pudo consultar el listado.</td></tr>
              ) : !orders.length ? (
                <tr><td colSpan="7" className="muted">
                  {debounced || stage || terminal || rx ? "Sin resultados para estos filtros." : "Sin pedidos en este rango."}
                </td></tr>
              ) : orders.map((o) => {
                const open = openId === o.id;
                return [
                  <tr key={o.id} className="ord-row" onClick={() => setOpenId(open ? null : o.id)}>
                    <td>
                      <b>{orderLabel(o)}</b>
                      {o.has_prescription && <span className="ord-rx" title="Lleva receta">👓</span>}
                    </td>
                    <td>{o.created_at ? new Date(o.created_at).toLocaleDateString("es") : "—"}</td>
                    <td><span title={o.customer.email || ""}>{o.customer.name || o.customer.email || "—"}</span></td>
                    <td>{o.shipping_address?.city ? `🚚 ${o.shipping_address.city}` : "🏬 Recogida"}</td>
                    <td className="r">{fmtMoney(o.total, o.currency_code)}</td>
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
            {count === 0 ? "0 pedidos" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, count)} de ${int(count)}`}
            {loading && orders.length ? " · actualizando…" : ""}
          </span>
          <div>
            <button className="btn-sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Anterior</button>
            <span className="adm-pager-n">{page + 1} / {pages}</span>
            <button className="btn-sm" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS = [["overview", "Resumen"], ["sales", "Ventas"], ["orders", "Pedidos"], ["products", "Productos"], ["prices", "Precios"]];

export default function AdminDashboard() {
  const [tab, setTab] = useState("overview");
  const [preset, setPreset] = useState("30d");
  const [find, setFind] = useState("");
  useEffect(() => { ensureSeed(); }, []);
  const onFind = (v) => { setFind(v); if (v) setTab("prices"); };
  return (
    <div className="adm-body">
      <div className="adm-navbar">
        <nav className="adm-tabs">
          {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
        </nav>
        <div className="adm-find" title="Buscar un producto para editar su precio">
          <span aria-hidden="true">🔎</span>
          <input placeholder="Buscar producto para editar precio…" value={find} onChange={(e) => onFind(e.target.value)} />
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
