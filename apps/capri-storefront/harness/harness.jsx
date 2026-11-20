import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "/src/i18n/LanguageContext.jsx";
import { FeedbackProvider } from "/src/components/Feedback.jsx";
import "/src/admin/admin.css";
import "/src/admin/sales-board.css";
import "/src/admin/cash-report.css";
import "/src/admin/store-statement.css";
import RxForm from "/src/admin/PosRx.jsx";
import { EMPTY_RX, validateRx } from "/src/admin/rxRules.js";
import PosFrameCard from "/src/admin/PosFrameCard.jsx";
import AdminShell from "/src/admin/AdminShell.jsx";
import { KpiCard, kpiDelta } from "/src/admin/charts.jsx";
import Icon from "/src/admin/icons.jsx";
import { receiptDuoHtml, receiptHtml, jobHtml, PRINT_CSS, DUO_PAGE_CSS } from "/src/admin/SaleDocuments.jsx";

// ?mode=light|dark fija el modo del panel (data-mode); ?store=web|neutral|<#hex> el tema de tienda
// en la vista `shell` (AdminShell real, con me=null → "web" o neutro; un hex se pinta a mano).
const Q = new URLSearchParams(location.search);
const MODE = Q.get("mode") || "light";
try { localStorage.setItem("adm_color_mode", MODE); } catch {}
const STORE = Q.get("store") || "web";
try { if (STORE === "neutral") localStorage.removeItem("adm_active_store"); else localStorage.setItem("adm_active_store", "web"); } catch {}

const frame = { kind: "frame", title: "DC241", brand: "DiCaprio", model: "DC241", color: "Black Gold", variant_title: "Black Gold", sku: "DC241-BG", barcode: "0123456789012", price: 90, image: "https://caprioptics.com/wp-content/uploads/2023/01/DC241-BLACK-GOLD-1.jpg", images: [], specs: { shape: "rectangular", material: "acetato", rim: "full", gender: "unisex", age_group: "adult", eye: 52, bridge: 18, temple: 140, lens_height: 38 }, variants: [{ id: "v1", title: "Black Gold", color: "Black Gold" }, { id: "v2", title: "Tortoise", color: "Tortoise" }] };
const money = (v) => `$${Number(v).toFixed(2)}`;
const doc = {
  kind: "receipt_duo", business: { name: "Óptica El Rancho", legal_name: "Óptica El Rancho LLC", url: "https://www.rubilens.com", support_email: null },
  store: { code: "Op2", name: "El Rancho 39", address: "3920 W Flagler St, Miami FL 33134", phone: "(305) 555-0139", receipt_note: "Garantía de 30 días en monturas. Los lentes con receta no tienen devolución." },
  terminal: { code: "T1", receipt_locale: "es", ticket_locale: "en", printer: "HP LaserJet" },
  sale: { id: "s1", number: "R39-000127", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), promised_on: "2026-11-08", seller_code: "DAN", tray: "14", status: "completed", voided_at: null, delivery: "pickup" },
  customer: { name: "Marilin García", phone: "(786) 555-0101" }, tracking_url: "https://www.rubilens.com/t/R39-000127", print: { count: 1, reprint: false, first_at: null },
  lines: [{ kind: "frame", title: "DiCaprio DC241", variant_title: "Black Gold", sku: "DC241-BG", list: 270, unit_price: 270, tax_amount: 0, frame_price: 90, lens_price: 180, quantity: 1, image_url: "https://caprioptics.com/wp-content/uploads/2023/01/DC241-BLACK-GOLD-1.jpg", design_code: "prog-mid", lens: { design: { es: "Progresivo gama media", en: "Progressive mid-range" }, material: { es: "Policarbonato", en: "Polycarbonate" }, photo: null, ar: { es: "Antirreflejo verde", en: "AR green" }, category: "prog" }, handling: "frame_supplied", frame: { brand: "DiCaprio", model: "DC241", material: "acetato", eye_size: 52, bridge: 18 }, own_frame: null }],
  totals: { list: 270, discount: 0, discount_pct: 0, tax: 0, total: 270, paid: 270, insurance: 0, balance: 0 },
  payments: [{ method_code: "zelle", method: { es: "Zelle", en: "Zelle" }, amount: 270, kind: "deposit", reference: "ZL-88213", created_at: new Date().toISOString() }],
  tickets: [],
};
function App() {
  const [rx, setRx] = useState({ ...EMPTY_RX, type: "multifocal", od: { ...EMPTY_RX.od, sph: "+2.25", add: "2.50" }, os: { ...EMPTY_RX.os, sph: "+3.00", cyl: "-0.75", axis: "110", add: "2.50" }, pd_od: "30", pd_os: "30", seg_height: "25", rx_date: "2026-10-31" });
  const [worn, setWorn] = useState({ ...EMPTY_RX });
  const [w, setW] = useState({ source: "lensometer", dateMode: "approx", date: "", months: "18" });
  const [wf, setWf] = useState({ lens_width: "", bridge: "", temple: "", lens_height: "", total_width: "", condition: "good" });
  const which = Q.get("v") || "rx";
  if (which === "shell") return <MemoryRouter><ShellSink /></MemoryRouter>;
  if (which === "duo") return <iframe id="duo" style={{ width: "11in", height: "8.5in", border: 0 }} srcDoc={`<!doctype html><html><head><style>${PRINT_CSS}${DUO_PAGE_CSS}</style></head><body>${receiptDuoHtml(doc)}</body></html>`} />;
  if (which === "rcpt") return <iframe id="duo" style={{ width: "80mm", height: "900px", border: 0 }} srcDoc={`<!doctype html><html><head><style>${PRINT_CSS}</style></head><body>${receiptHtml(doc)}</body></html>`} />;
  return (
    <div className="adm-shell" data-store-theme="store" data-mode={MODE} style={{ display: "block" }}><div className="adm-main" style={{ marginLeft: 0, minHeight: 0 }}><div className="adm-section pos" style={{ padding: 16, maxWidth: 1100 }}>
      <div className="adm-card pos-card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>Paso 2 · montura</h3>
        <ul className="pos-lines"><li className="pos-line-card"><PosFrameCard frame={frame} money={money} onRemove={() => {}} onChangeColor={() => {}} /></li></ul>
      </div>
      <div className="adm-card pos-card" style={{ marginBottom: 16 }}>
        <PosFrameCard frame={frame} money={money} compact />
        <h3 style={{ margin: "8px 0" }}>Paso 3 · receta nueva</h3>
        <RxForm mode="new" idp="new" value={rx} onChange={setRx} type={rx.type} showErrors source="ocr" />
      </div>
      <div className="adm-card pos-card">
        <h3 style={{ margin: "0 0 8px" }}>Paso 1 · graduación que usa hoy</h3>
        <RxForm mode="worn" idp="worn" value={worn} onChange={setWorn} type={worn.type} worn={w} onWornChange={setW} wornFrame={wf} onWornFrameChange={setWf} history={[]} />
      </div>
    </div></div></div>
  );
}
/* Vista `shell`: el armazón real con una muestra de cada pieza del panel, para
   mirar el modo claro/oscuro con el cromo de una tienda. */
function ShellSink() {
  const [rx, setRx] = useState({ ...EMPTY_RX, type: "multifocal", od: { ...EMPTY_RX.od, sph: "+2.25", add: "2.50" }, os: { ...EMPTY_RX.os, sph: "+3.00", cyl: "-0.75", axis: "110", add: "2.50" }, pd_od: "30", pd_os: "30", seg_height: "25", rx_date: "2026-10-31" });
  const [tab, setTab] = useState("pos");
  return (
    <AdminShell tab={tab} onTab={setTab} user="dueno@optica.com" onLogout={() => {}} find="" onFind={() => {}} badges={{ approvals: 2 }}>
      <div className="adm-section pos">
        <h2>Ventas de hoy</h2>
        <p className="adm-sub">Resumen de la jornada en El Rancho 41.</p>
        <div className="adm-kpis">
          <KpiCard label="Ventas" value="$4,320" delta="+12%" deltaGood icon={<Icon name="dollar" size={18} />} sub="vs. ayer" />
          <KpiCard label="Tickets" value="27" delta="-3%" icon={<Icon name="receipt" size={18} />} sub="vs. ayer" />
          <KpiCard label="Ticket medio" value="$160" icon={<Icon name="trendUp" size={18} />} delta={kpiDelta(160, 160, { kind: "money", fmt: (v) => `$${v.toFixed(2)}` })} sub="vs. ayer" />
          <KpiCard label="Costo" value="$1,980" icon={<Icon name="costs" size={18} />} delta={kpiDelta(1980, 2100, { kind: "money", invert: true, fmt: (v) => `$${v.toFixed(2)}` })} sub="vs. ayer" />
          <KpiCard label="Margen" value="48%" icon={<Icon name="percent" size={18} />} delta={kpiDelta(48, 46.5, { kind: "pct" })} sub="vs. ayer" />
        </div>
        <div className="sb-root"><div className="sb-bar" style={{ position: "static" }}>
          <div className="sb-chips"><button type="button" className="on">Día</button><button type="button">Semana</button><button type="button">Mes</button></div>
          <div className="adm-range"><button type="button" className="on">Tienda</button><button type="button">Vendedor</button><button type="button">Producto</button></div>
          <select className="adm-sel" style={{ width: "auto" }}><option>Todas las tiendas</option><option>El Rancho 41</option></select>
          <span className="sb-dates"><input type="date" defaultValue="2026-10-31" /> → <input type="date" defaultValue="2026-10-31" /></span>
          <label className="sb-toggle"><input type="checkbox" defaultChecked /> Con costo</label>
          <span className="sb-export"><button type="button" className="btn-xs">CSV</button><button type="button" className="btn-xs">PDF</button></span>
        </div>
        <div className="sb-totals">
          <div className="sb-tile"><small>Neto</small><b>$4,120</b><i className="good">+8%</i></div>
          <div className="sb-tile click"><small>Costo</small><b>$1,980</b><i>48%</i></div>
          <div className="sb-tile"><small>Ganancia</small><b className="neg">-$120</b><i className="bad">-2%</i></div>
        </div></div>
        <div className="adm-subtabs"><button type="button" className="on"><Icon name="sales" size={14} /> Ventas</button><button type="button">Costos</button><button type="button">Resumen</button></div>
        <div className="ss-attention">
          <button type="button" className="ss-alert bad"><Icon name="alert" size={16} /><span>2 cajas sin cerrar desde ayer</span></button>
          <button type="button" className="ss-alert warn"><Icon name="alert" size={16} /><span>3 trabajos vencen hoy</span></button>
          <button type="button" className="ss-alert info"><Icon name="info" size={16} /><span>Hay una aprobación de descuento pendiente</span></button>
        </div>
        <div className="adm-grid-2">
          <div className="adm-card">
            <h3><Icon name="store" /> Formulario</h3>
            <div className="adm-form-grid">
              <label className="adm-field">Nombre<input className="adm-input" defaultValue="Marilin García" /></label>
              <label className="adm-field">Tienda<select className="adm-sel"><option>El Rancho 41</option><option>Fry Family Clinic</option></select></label>
              <label className="adm-field">Precio<input className="adm-price-input" defaultValue="270.00" /></label>
              <label className="adm-field">Vacío<input className="adm-input" placeholder="Escribe aquí…" /></label>
            </div>
            <div className="adm-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn-sm primary">Guardar</button><button type="button" className="btn-sm">Cancelar</button><button type="button" className="btn-sm danger">Borrar</button><button type="button" className="btn-sm ghost">Más</button><button type="button" className="btn-sm" disabled>Inactivo</button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              <span className="adm-chip">Pendiente</span><span className="adm-chip ok">Entregado</span><span className="adm-chip warn">En laboratorio</span><span className="adm-chip bad">Anulada</span><span className="adm-chip gold">Oro</span><span className="adm-chip neutral">Neutro</span>
            </div>
            <label className="adm-switch" style={{ marginTop: 12 }}><input type="checkbox" defaultChecked /> Activa</label>
            <div className="adm-src-note real" style={{ marginTop: 12 }}><b>Datos reales</b> · servidor</div>
            <div className="adm-login-err">No se pudo guardar la tienda.</div>
          </div>
          <div className="adm-card">
            <h3><Icon name="orders" /> Tabla</h3>
            <div className="adm-table-wrap"><table className="adm-table">
              <thead><tr><th>#</th><th>Cliente</th><th className="sortable on">Tienda</th><th className="r">Total</th></tr></thead>
              <tbody>
                <tr><td>R41-000127</td><td>Marilin García</td><td>El Rancho 41</td><td className="r num">$270.00</td></tr>
                <tr><td>R41-000128</td><td>José Pérez</td><td>El Rancho 41</td><td className="r num">$145.00</td></tr>
                <tr><td>R41-000129</td><td>Ana Ruiz</td><td>Fry Family Clinic</td><td className="r num">$390.00</td></tr>
              </tbody>
            </table></div>
            <div className="adm-pager"><span className="adm-pager-n">3 de 27</span><div><button type="button" className="btn-xs">‹</button><button type="button" className="btn-xs">›</button></div></div>
            <div className="cost-accordions" style={{ marginTop: 12 }}>
              <details className="cost-accordion" open><summary><Icon name="costs" size={16} /> Materiales <span className="sb-acc-n">4 reglas</span></summary><div style={{ padding: "0 14px 12px" }}>
                <div className="cost-rule"><div className="cost-rule-name"><b>Montura</b><small className="muted">por pedido</small></div><input className="adm-price-input" defaultValue="40" /><span>USD</span><button type="button" className="btn-xs">Editar</button></div>
                <div className="cost-rule undefined"><div className="cost-rule-name"><b>Estuche</b><small className="muted">sin definir</small></div><input className="adm-price-input" placeholder="0" /><span>USD</span><button type="button" className="btn-xs">Editar</button></div>
              </div></details>
              <details className="sb-acc"><summary><Icon name="sales" size={16} /> Vendedores <span className="sb-acc-n">3</span><span className="sb-acc-sum">$4,120</span></summary></details>
            </div>
          </div>
        </div>
        <div className="adm-card pos-card" style={{ marginBottom: 16 }}>
          <PosFrameCard frame={frame} money={money} compact />
          <h3 style={{ margin: "8px 0" }}>Receta nueva</h3>
          <RxForm mode="new" idp="new" value={rx} onChange={setRx} type={rx.type} showErrors source="ocr" />
        </div>
        <div className="adm-card pos-card">
          <ul className="pos-lines"><li className="pos-line-card"><PosFrameCard frame={frame} money={money} onRemove={() => {}} onChangeColor={() => {}} /></li></ul>
        </div>
      </div>
    </AdminShell>
  );
}
try { localStorage.setItem("oer_lang", "es"); } catch {}
document.body.style.background = MODE === "dark" ? "#0f1218" : "#f3f4f6";
createRoot(document.getElementById("root")).render(<LanguageProvider><FeedbackProvider><App /></FeedbackProvider></LanguageProvider>);
