import { useState, useEffect, useMemo, useSyncExternalStore, useRef } from "react";
import { KpiCard, LineChart, BarChart, DonutChart, Funnel, AccessVsBuyChart, WeekdayChart } from "./charts.jsx";
import { ensureSeed, summarize, rangeFor, subscribe as onAnalytics, clearDemo, productSales, allOrders, updateOrderStatus } from "./analytics.js";
import { useCatalog } from "../data/catalogStore.js";
import { BRANDS, BRAND_BY_SLUG } from "../data/brands.js";
import * as PS from "./priceStore.js";

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

function Prices({ preQ }) {
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
    rd.onload = () => { try { PS.importJSON(rd.result); } catch { alert("JSON inválido"); } };
    rd.readAsText(f);
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>Precios</h2>
        <div className="adm-actions">
          <button className="btn-sm" onClick={PS.exportJSON}>Exportar JSON</button>
          <button className="btn-sm" onClick={() => fileRef.current?.click()}>Importar</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={doImport} />
          <button className="btn-sm danger" onClick={() => { if (confirm("¿Restablecer TODOS los precios a los valores base?")) PS.resetAll(); }}>Restablecer</button>
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
    </div>
  );
}

const OSTATUS = {
  processing: ["📦", "En preparación", "#b26a00", "#fbf0df"],
  shipped: ["🏷️", "Enviado", "#0E5AD0", "#eaf2ff"],
  in_transit: ["🚚", "En camino", "#7b4aa0", "#f1e9f7"],
  delivered: ["✅", "Entregado", "#2e7d46", "#e9f5ee"],
};
const OSTEPS = ["processing", "shipped", "in_transit", "delivered"];

function Orders() {
  const snap = useAnalyticsTick();
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);
  const orders = useMemo(() => allOrders(), [snap]);
  const shown = filter === "all" ? orders : filter === "done" ? orders.filter((o) => o.status === "delivered") : orders.filter((o) => o.status !== "delivered");
  const proc = orders.filter((o) => o.status !== "delivered").length;
  const done = orders.length - proc;
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>Pedidos</h2>
        <div className="adm-range">
          {[["all", "Todos"], ["proc", "En proceso"], ["done", "Entregados"]].map(([k, l]) =>
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>
      <div className="adm-kpis">
        <KpiCard label="Pedidos" value={int(orders.length)} icon="🧾" />
        <KpiCard label="En proceso" value={int(proc)} icon="⏳" />
        <KpiCard label="Entregados" value={int(done)} icon="✅" deltaGood />
        <KpiCard label="Ingresos" value={money(revenue)} icon="💵" />
      </div>
      <div className="adm-card">
        <div className="adm-table-wrap">
          <table className="adm-table orders">
            <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Método</th><th className="r">Total</th><th>Estado / proceso</th></tr></thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan="6" className="muted">Sin pedidos.</td></tr> : shown.map((o) => {
                const st = OSTATUS[o.status || "processing"];
                const ship = o.shipping?.method === "ship";
                const open = openId === o.id;
                return [
                  <tr key={o.id} className="ord-row" onClick={() => setOpenId(open ? null : o.id)}>
                    <td><b>{o.id}</b>{o.demo && <span className="tag-demo">demo</span>}</td>
                    <td>{new Date(o.t).toLocaleDateString("es")}</td>
                    <td>{o.customer ? <span title={o.customer.email}>{o.customer.name} {o.customer.surname}</span> : (o.user || "—")}</td>
                    <td>{ship ? `🚚 ${o.delivery?.city || "Envío"}` : "🏬 Recogida"}</td>
                    <td className="r">{money(o.total)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span className="ord-badge" style={{ background: st[3], color: st[2] }}>{st[0]} {st[1]}</span>
                      <select className="adm-sel ord-sel" value={o.status || "processing"} onChange={(e) => updateOrderStatus(o.id, e.target.value)}>
                        {OSTEPS.map((s) => <option key={s} value={s}>{OSTATUS[s][0]} {OSTATUS[s][1]}</option>)}
                      </select>
                    </td>
                  </tr>,
                  open && (
                    <tr key={o.id + "-d"} className="ord-detail"><td colSpan="6">
                      <div className="ord-detail-grid">
                        <div>
                          <b>🛍️ Artículos</b>
                          <ul>{o.items.map((it, i) => <li key={i}><span>{it.name}</span><b>{money(it.total)}</b></li>)}</ul>
                        </div>
                        <div>
                          <b>{ship ? "🚚 Entrega" : "🏬 Recogida en tienda"}</b>
                          {ship && o.delivery ? (
                            <p className="ord-addr">📍 {o.delivery.address}, {o.delivery.city}<br />👤 {o.delivery.recipient} · 📞 {o.delivery.phone}<br />✉️ {o.delivery.email} · 🏷️ {o.delivery.carrier || "—"}</p>
                          ) : <p className="ord-addr muted">El cliente recoge en la sucursal.</p>}
                          {o.customer && <p className="ord-addr">🧾 {o.customer.name} {o.customer.surname} · {o.customer.email} · {o.customer.phone}</p>}
                        </div>
                      </div>
                    </td></tr>
                  ),
                ];
              })}
            </tbody>
          </table>
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
