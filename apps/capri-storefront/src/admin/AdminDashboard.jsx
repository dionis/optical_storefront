import { useState, useEffect, useMemo, useSyncExternalStore, useRef } from "react";
import { KpiCard, LineChart, BarChart, DonutChart, Funnel } from "./charts.jsx";
import { ensureSeed, summarize, rangeFor, subscribe as onAnalytics, clearDemo } from "./analytics.js";
import { useCatalog } from "../data/catalogStore.js";
import * as PS from "./priceStore.js";

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
        <div className="adm-card"><h3>Ventas por marca</h3><DonutChart data={s.topBrands} /></div>
        <div className="adm-card"><h3>Top productos (ingresos)</h3><ThumbBars data={s.topProducts} imgByName={imgByName} valuePrefix="$" emptyMsg="Sin ventas aún" /></div>
      </div>
      <div className="adm-card"><h3>Accesos por día</h3><LineChart data={s.accessSeries} color="#2e7d46" area={false} /></div>
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
        <BarChart data={brandRows.map(([label, value]) => ({ label, value }))} horizontal />
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

function Prices() {
  const { products, cases } = useCatalog();
  const [ov, setOv] = useState(PS.getOverrides());
  useEffect(() => PS.subscribe(() => setOv(PS.getOverrides())), []);
  const [q, setQ] = useState("");
  const fileRef = useRef(null);

  const frames = useMemo(() => products.filter((p) => `${p.name} ${p.brand}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200), [products, q]);

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
          <h3 style={{ marginTop: 14 }}>Envío ($)</h3>
          <div className="adm-price-row"><span>Estándar</span><PriceInput value={ov.shipping.standard} placeholder="4.95" onCommit={(v) => PS.setShipping({ standard: Number(v) || 0 })} /></div>
          <div className="adm-price-row"><span>Exprés</span><PriceInput value={ov.shipping.express} placeholder="12.95" onCommit={(v) => PS.setShipping({ express: Number(v) || 0 })} /></div>
          <div className="adm-price-row"><span>Envío gratis desde</span><PriceInput value={ov.shipping.freeThreshold} placeholder="59" onCommit={(v) => PS.setShipping({ freeThreshold: Number(v) || 0 })} /></div>
        </div>
      </div>

      <div className="adm-card">
        <h3>Accesorios · estuches ($)</h3>
        <div className="adm-price-grid">
          {cases.map((c) => (
            <div className="adm-price-row" key={c.slug}><span>{c.name} <small className="muted">base {money(c.basePrice ?? c.price)}</small></span>
              <PriceInput value={ov.cases[c.sku]} placeholder={String(c.basePrice ?? c.price)} onCommit={(v) => PS.setCasePrice(c.sku, v)} /></div>
          ))}
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-head-row"><h3>Monturas ({int(products.length)}) · precio por modelo</h3>
          <input className="adm-search" placeholder="Buscar modelo o marca…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="adm-price-grid">
          {frames.map((p) => (
            <div className="adm-price-row" key={p.slug}><span>{p.name} <small className="muted">{p.brand} · base {money(p.basePrice ?? p.price)}</small></span>
              <PriceInput value={ov.frames[p.sku]} placeholder={String(p.basePrice ?? p.price)} onCommit={(v) => PS.setFramePrice(p.sku, v)} /></div>
          ))}
        </div>
        {products.length > 200 && <p className="muted">Mostrando 200 — usa el buscador para acotar.</p>}
      </div>
    </div>
  );
}

const TABS = [["overview", "Resumen"], ["sales", "Ventas"], ["products", "Productos"], ["prices", "Precios"]];

export default function AdminDashboard() {
  const [tab, setTab] = useState("overview");
  const [preset, setPreset] = useState("30d");
  useEffect(() => { ensureSeed(); }, []);
  return (
    <div className="adm-body">
      <nav className="adm-tabs">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </nav>
      {tab === "overview" && <Overview preset={preset} setPreset={setPreset} />}
      {tab === "sales" && <Sales preset={preset} setPreset={setPreset} />}
      {tab === "products" && <Products preset={preset} setPreset={setPreset} />}
      {tab === "prices" && <Prices />}
    </div>
  );
}
