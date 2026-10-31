import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "/src/i18n/LanguageContext.jsx";
import { FeedbackProvider } from "/src/components/Feedback.jsx";
import "/src/admin/admin.css";
import RxForm from "/src/admin/PosRx.jsx";
import { EMPTY_RX, validateRx } from "/src/admin/rxRules.js";
import PosFrameCard from "/src/admin/PosFrameCard.jsx";
import { receiptDuoHtml, receiptHtml, jobHtml, PRINT_CSS, DUO_PAGE_CSS } from "/src/admin/SaleDocuments.jsx";

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
  const which = new URLSearchParams(location.search).get("v") || "rx";
  if (which === "duo") return <iframe id="duo" style={{ width: "11in", height: "8.5in", border: 0 }} srcDoc={`<!doctype html><html><head><style>${PRINT_CSS}${DUO_PAGE_CSS}</style></head><body>${receiptDuoHtml(doc)}</body></html>`} />;
  if (which === "rcpt") return <iframe id="duo" style={{ width: "80mm", height: "900px", border: 0 }} srcDoc={`<!doctype html><html><head><style>${PRINT_CSS}</style></head><body>${receiptHtml(doc)}</body></html>`} />;
  return (
    <div className="adm-shell" data-store-theme="store" style={{ display: "block" }}><div className="adm-main" style={{ marginLeft: 0, minHeight: 0 }}><div className="adm-section pos" style={{ padding: 16, maxWidth: 1100 }}>
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
try { localStorage.setItem("oer_lang", "es"); } catch {}
createRoot(document.getElementById("root")).render(<LanguageProvider><FeedbackProvider><App /></FeedbackProvider></LanguageProvider>);
