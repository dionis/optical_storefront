// Banco de pruebas del paso «Montura» de Nueva venta: el buscador del catálogo
// y la tarjeta de la montura elegida, con el MISMO cableado que PosSale.jsx
// (addFrame → frameLineFields → PosFrameCard + onChangeColor). Sirve para
// reproducir sin backend el fallo de «elijo un color y la pantalla se queda en
// blanco»: cualquier excepción al pintar se recoge y se muestra en la página.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "/src/i18n/LanguageContext.jsx";
import { FeedbackProvider } from "/src/components/Feedback.jsx";
import "/src/admin/admin.css";
import PosFrameSearch from "/src/admin/PosFrameSearch.jsx";
import PosFrameCard, { frameLineFields } from "/src/admin/PosFrameCard.jsx";
import PosSale from "/src/admin/PosSale.jsx";
import AdminFrameCard from "/src/admin/AdminFrameCard.jsx";
import { MemoryRouter } from "react-router-dom";
import AdminShell, { navGroupsFor } from "/src/admin/AdminShell.jsx";
import PosSales from "/src/admin/PosSales.jsx";
import PosCash from "/src/admin/PosCash.jsx";

// adminFetch exige sesión antes de llamar: sin esto el buscador contesta
// «no se pudo buscar en el catálogo» y nunca se llega al fallo que se busca.
sessionStorage.setItem("oer_admin_session", JSON.stringify({ token: "harness", exp: Date.now() + 864e5 }));

const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const V = (id, color, sku, image) => ({ id, title: color, sku, barcode: sku ? `0${sku}` : null, image, color, price: null });
const PRODUCTS = [
  { product_id: "prod_dc252", title: "DC252", thumbnail: "/img/a.jpg", price: 50.97,
    variants: [V("var_1", "Negro/Dorado", "DC252-BK", "/img/a.jpg"), V("var_2", "Carey", "DC252-TT", "/img/b.jpg"), V("var_3", "Plata", "DC252-SV", null)],
    matched_variant_ids: [], brand: "Di Caprio", model: "DC252", images: ["/img/a.jpg", "/img/b.jpg"],
    specs: { shape: "square", rim: "full", material: "metal", gender: "men", age_group: "adult", eye: 51, bridge: 18, temple: 145, lens_height: 38 } },
  // Casos límite que el catálogo real sí produce: color vacío, sin ficha, sin fotos.
  { product_id: "prod_gr829", title: "GR 829", thumbnail: null, price: 50.97,
    variants: [V("var_4", "", null, null), V("var_5", "Azul", "GR829-BL", null)],
    matched_variant_ids: [], brand: "Grande", model: "GR 829", images: [], specs: null },
];
const CTX = {
  is_admin: true,
  stores: [{ id: "est_02", code: "Op2", name: "Fry Family", color: "#2e7d5b", currency: "usd",
    payment_methods: ["cash", "card", "zelle"], terminals: [{ id: "t1", code: "C1", name: "Caja 1" }] }],
  payment_methods: [{ code: "cash", label: "Efectivo" }, { code: "card", label: "Tarjeta" }, { code: "zelle", label: "Zelle" }],
};
// Cliente ya registrado (HU-18): se encuentra por los últimos 10 dígitos del
// teléfono o por el correo, como hace el servidor.
const KNOWN = { id: "cus_ana", first_name: "Ana", last_name: "Pérez", email: "ana@example.com", phone: "+1 (305) 555-0123", birth_date: "1980-05-02" };
const digits = (v) => String(v || "").replace(/\D/g, "");
// Cotización simulada con la MISMA forma que /admin/pos/quote (lib/pos-data.ts):
// montura a precio de tienda, lente base por diseño + foto + AR. Solo para
// pintar la franja del total en curso; el servidor real es la única verdad.
const LENS_BASE = { sv: 60, bifocal: 130 };
const PHOTO_PRICE = 85; const AR_PRICE = 60;
const QUOTE_DELAY = Number(new URLSearchParams(location.search).get("delay") || 350);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mockQuote(body) {
  const pct = Number(body.discount_pct) || 0;
  const lines = (body.lines || []).map((l) => {
    const sel = l.selection || {};
    const own = l.kind === "own_frame";
    if (!own && sel.design_code !== "frame-only" && !sel.material_code) throw Object.assign(new Error("bad_lens"), { reason: "bad_lens" });
    if (own && !sel.material_code) throw Object.assign(new Error("bad_lens"), { reason: "bad_lens" });
    const frameList = own ? 0 : 50.97;
    const lensList = sel.design_code === "frame-only" ? 0 : (LENS_BASE[sel.design_code] ?? 180) + (sel.photo_code ? PHOTO_PRICE : 0) + (sel.ar_code ? AR_PRICE : 0);
    const frame = +(frameList * (1 - pct / 100)).toFixed(2); const lenses = +(lensList * (1 - pct / 100)).toFixed(2);
    const tax_amount = !own && sel.design_code === "frame-only" ? +(frame * 0.07).toFixed(2) : 0;
    const v = own ? null : PRODUCTS.flatMap((p) => p.variants.map((x) => ({ p, x }))).find(({ x }) => x.id === l.variant_id);
    return { kind: l.kind, variant_id: l.variant_id, product_id: v?.p.product_id ?? null, title: own ? l.description : v?.p.title ?? "", variant_title: v?.x.title ?? null, sku: v?.x.sku ?? null, selection: sel, description: l.description,
      lens_category: sel.design_code === "frame-only" ? null : sel.design_code, eye_size: 51, list: +(frameList + lensList).toFixed(2), frame, lenses, tax_amount, tax_rate: tax_amount ? 0.07 : 0, unit_price: +(frame + lenses + tax_amount).toFixed(2), frame_source: own ? "own_frame" : "store_exact", below_minimum: false };
  });
  const list_cents = lines.reduce((s, l) => s + Math.round(l.list * 100), 0);
  const tax_cents = lines.reduce((s, l) => s + Math.round(l.tax_amount * 100), 0);
  const total_cents = lines.reduce((s, l) => s + Math.round(l.unit_price * 100), 0);
  return { quote: { lines, discount_pct: pct, list_cents, discount_cents: list_cents - (total_cents - tax_cents), tax_cents, total: total_cents / 100, total_cents, below_minimum: false }, optical_change: null, limit_pct: 15, needs_approval: pct > 15, rx_check: body.prescription ? { fulfillable: true, warnings: [] } : null };
}
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/admin/pos/context")) return json(CTX);
  if (/\/admin\/pos\/customers\/[^?]+/.test(url)) return json({ ...KNOWN, sales: [{ id: "s1" }], history: [], last_prescription: null });
  if (url.includes("/admin/pos/customers")) {
    const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [])[1] || "");
    const hit = (digits(q).length >= 7 && digits(KNOWN.phone).endsWith(digits(q).slice(-10))) || q.toLowerCase() === KNOWN.email || /ana/i.test(q);
    return json({ customers: hit ? [KNOWN] : [] });
  }
  if (url.includes("/admin/pos/quote")) {
    await sleep(QUOTE_DELAY);
    try { return json(mockQuote(JSON.parse(init?.body || "{}"))); }
    catch (e) { return new Response(JSON.stringify({ reason: e.reason || "generic", message: e.message }), { status: 422, headers: { "Content-Type": "application/json" } }); }
  }
  if (url.includes("/admin/pos/products")) {
    const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [])[1] || "").toLowerCase();
    return json({ products: PRODUCTS.filter((p) => !q || p.title.toLowerCase().includes(q)) });
  }
  // Ventas de tienda (PosSales) y ficha (SaleDetailPanel): forma de lib/pos-data.ts toSale().
  if (/\/admin\/pos\/sales\/[^/?]+$/.test(url.split("?")[0])) {
    const id = url.split("?")[0].split("/").pop();
    const s = SALES.find((x) => x.id === id) || SALES[0];
    return json({ sale: { ...s, lines: [{ kind: "frame", title: "DC252", variant_title: "Negro/Dorado", unit_price: s.total, selection: { design_code: "sv", material_code: "poly" } }], customer: KNOWN, prescription: null }, ...s });
  }
  if (url.includes("/admin/pos/sales")) return json({ sales: SALES, has_more: false });
  if (url.includes("/admin/sales-analytics/sales")) return json({ sales: [], has_more: false, access: { profit: true, commission: true } });
  if (url.includes("/admin/pos/cash-sessions")) return json({ sessions: CASH_SESSIONS });
  // Lectura de la receta (OCR) simulada: lo que devolvería /admin/pos/prescriptions/ocr.
  if (url.includes("/admin/pos/prescriptions/ocr")) { await sleep(400); return json({ prescription: { od: { sph: -2.25, cyl: -0.5, axis: 180 }, os: { sph: -2, cyl: -0.75, axis: 175 }, pd: 63 } }); }
  if (url.includes("/admin/pos/cash-report")) return json({ totals: { payments_cents: 182000, cash_payments_cents: 64000, card_cents: 98000, other_cents: 20000, receivable_cents: 0, movements_in_cents: 5000, movements_out_cents: 20000, cash_net_cents: 49000, fees_cents: 2900, sessions_diff_cents: -500 }, by_method: [], movements: [], sessions: [], series: [], by_category: [] });
  return json({});
};

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("[harness] la pantalla reventó:", err, info?.componentStack); }
  render() {
    if (this.state.err) return <pre id="crash" style={{ color: "#b00", padding: 16, whiteSpace: "pre-wrap" }}>CRASH: {String(this.state.err?.stack || this.state.err)}</pre>;
    return this.props.children;
  }
}

const ME = { id: "u1", role: "owner", is_admin: true, display_name: "Rubí Dacosta", privileges: [] };
const Q = new URLSearchParams(location.search);
const MODE = Q.get("mode") === "dark" ? "dark" : "light";
try { localStorage.setItem("adm_color_mode", MODE); } catch { /* noop */ }
const today = new Date().toISOString().slice(0, 10);
const SALES = [0, 1, 2, 3, 4, 5, 6].map((i) => {
  const total = [270, 455.5, 189, 612.25, 320, 99, 742][i];
  const paid = i % 3 === 0 ? 100 : total;
  return {
    id: `sale_${i}`, number: `Op2-00${120 + i}`, establishment_id: "est_02", terminal_id: "t1", seller_id: null, seller_code: i % 2 ? "DAN" : "JOS",
    customer_id: "cus_ana", order_id: `order_${i}`, list: total, discount: 0, discount_pct: 0, total, paid, insurance: 0, balance: Math.round((total - paid) * 100) / 100,
    status: i === 5 ? "voided" : i === 2 ? "delivered" : "completed", tray: `Op2-${10 + i}`, promised_on: today, delivery: "pickup", delivered_at: null,
    voided_at: i === 5 ? `${today}T15:00:00Z` : null, void_reason: i === 5 ? "customer" : null, void_note: null, void_requested_at: null,
    created_at: `${today}T1${i}:05:00Z`, customer_name: ["Ana Pérez", "Luis Soto", "Marilin García"][i % 3], customer_phone: "(305) 555-0123",
    frame_brand: "Di Caprio", frame_model: "DC252", frame_color: "Negro/Dorado", has_rx: i % 2 === 0, own_frame: i === 4,
    lens_summary: { es: "Monofocal · Policarbonato · AR Green", en: "Single vision · Polycarbonate · AR Green" },
    payments: [{ method_code: i % 2 ? "card" : "cash", amount: paid, kind: "deposit", reference: null, created_at: `${today}T1${i}:06:00Z` }],
  };
});
const P = (name, code) => ({ id: code, name, code });
const CASH_SESSIONS = [
  { id: "cs_open", establishment_id: "est_02", terminal_id: null, status: "open", opened_by_person: P("Daniela Ruiz", "DAN"), opened_at: `${today}T13:00:00Z`, opened_signature: "DR", opening_note: null, opening: 100,
    closed_at: null, expected: 790, counted: null, diff: null, note: null, cash_in_sales: 940, cash_payments_count: 5, refunds: 0, manual_in: 50, manual_out: 300,
    movements: [
      { id: "m1", kind: "in", amount_cents: 10000, amount: 100, category: "opening_float", note: null, by: P("Daniela Ruiz", "DAN"), created_at: `${today}T13:00:00Z`, sale_id: null, terminal_code: "Caja 1" },
      { id: "m2", kind: "in", amount_cents: 27000, amount: 270, category: "sale_payment", note: "Op2-00120", by: P("Daniela Ruiz", "DAN"), created_at: `${today}T14:10:00Z`, sale_id: "sale_0", terminal_code: "Caja 1" },
      { id: "m3", kind: "out", amount_cents: 30000, amount: 300, category: "supplier_payment", note: "Factura 1234", by: P("Daniela Ruiz", "DAN"), created_at: `${today}T15:30:00Z`, sale_id: null, terminal_code: "Caja 1" },
      { id: "m4", kind: "in", amount_cents: 5000, amount: 50, category: "change_fund", note: "Cambio", by: P("José Pérez", "JOS"), created_at: `${today}T16:00:00Z`, sale_id: null, terminal_code: "Caja 1" },
    ] },
  { id: "cs_prev", establishment_id: "est_02", terminal_id: null, status: "pending_approval", opened_by_person: P("Daniela Ruiz", "DAN"), opened_at: "2026-11-05T13:00:00Z", opened_signature: "DR", opening: 100,
    closed_at: "2026-11-05T23:00:00Z", closed_by_person: P("José Pérez", "JOS"), closed_signature: "JP", expected: 730, counted: 725, diff: -5, note: "Faltan 5", cash_in_sales: 850, refunds: 20, manual_in: 0, manual_out: 200, movements: [] },
  { id: "cs_old", establishment_id: "est_02", terminal_id: null, status: "closed", opened_by_person: P("Daniela Ruiz", "DAN"), opened_at: "2026-11-04T13:00:00Z", opening: 100,
    closed_at: "2026-11-04T23:00:00Z", closed_by_person: P("Daniela Ruiz", "DAN"), closed_signature: "DR", expected: 610, counted: 610, diff: 0, cash_in_sales: 510, refunds: 0, manual_in: 0, manual_out: 0, movements: [] },
];


// Modelo COMPLETO para la ficha de montura (AdminFrameCard): medidas enteras,
// tres colores con foto y marca CON logo (di-caprio) — es el caso que el dueño
// usa para revisar el rediseño. La forma del objeto es la del catálogo local
// (public/catalog.json → catalogStore.js): colors[].name, attributes.*.
const CARD_PRODUCT = {
  sku: "DC252", name: "DC252", brand: "Di Caprio", brand_slug: "di-caprio",
  price: 50.97, originalPrice: 69.0, medusaId: "prod_dc252",
  colors: [
    { name: "Negro / Dorado", image: "/lookbook/model-01.jpg", hex: "#141414" },
    { name: "Carey", image: "/lookbook/model-02.jpg", hex: "#8a5a2b" },
    { name: "Plata", image: "/lookbook/model-03.jpg", hex: "#c8ccd2" },
  ],
  attributes: {
    shape: "Cuadrado", material: ["Acetato", "Metal"], gender: "Hombres",
    age: "Adulto", rim: "Full frame",
    eye_size: "51-53 mm", bridge_size: "18-19 mm", temple_length: "145-150 mm",
    lens_height: "38-40 mm",
  },
};

// Marca SIN logo en data/brands.js: comprueba que la ficha cae con elegancia al
// nombre de la marca en vez de dejar un hueco.
const CARD_PRODUCT_NOLOGO = {
  ...CARD_PRODUCT, sku: "ZZ100", name: "ZZ100", brand: "Marca Sin Logo",
  brand_slug: "marca-sin-logo", originalPrice: null,
  colors: [CARD_PRODUCT.colors[0]],
};

// Pantalla aislada de la ficha: el modal se repinta siempre (sin cerrar) para
// poder capturarlo en claro y en oscuro sin tocar el buscador.
function CardOnly() {
  const nologo = new URLSearchParams(location.search).get("nologo") === "1";
  const mode = new URLSearchParams(location.search).get("mode") === "dark" ? "dark" : "light";
  return (
    <div className="adm-shell" data-mode={mode} style={{ minHeight: "100vh" }}>
      <AdminFrameCard product={nologo ? CARD_PRODUCT_NOLOGO : CARD_PRODUCT} onClose={() => {}} />
    </div>
  );
}

function App() {
  // ?screen=sale monta el paso de venta REAL (PosSale), que es donde el dueño
  // ve la pantalla en blanco; sin parámetro, solo el buscador y la tarjeta.
  const screen = new URLSearchParams(location.search).get("screen");
  // ?shell=1 monta la pantalla dentro del AdminShell real (barra lateral,
  // cabecera, cajón hamburguesa) para revisarla en tablet: ?screen=sale|possales|cash&mode=dark&step=N.
  if (Q.get("shell") === "1") return <ShellScreen screen={screen || "sale"} />;
  if (screen === "sale") return <PosSale me={ME} />;
  // ?screen=card monta SOLO la ficha de montura (el modal del ojo del buscador).
  if (screen === "card") return <CardOnly />;
  return <Mini />;
}

const SHELL_TAB = { sale: "pos", possales: "possales", cash: "cash" };
function ShellScreen({ screen }) {
  const [tab, setTab] = useState(SHELL_TAB[screen] || "pos");
  const body = tab === "possales" ? <PosSales me={ME} /> : tab === "cash" ? <PosCash me={ME} /> : <PosSale me={ME} />;
  return (
    <MemoryRouter>
      <AdminShell tab={tab} onTab={setTab} user="dueno@optica.com" onLogout={() => {}} find={null} me={ME} groups={navGroupsFor(ME)}>
        {body}
      </AdminShell>
    </MemoryRouter>
  );
}

// Traduce el producto que devuelve el buscador del POS a la forma del catálogo
// local, que es lo que la ficha espera. En la aplicación real ese salto lo da
// `frameCardOf()` en PosSale.jsx buscando el modelo en `useCatalog()`; aquí se
// hace a mano para poder probar «ojo del buscador → ficha» sin backend y sin
// tener que crear antes un cliente (el paso «Montura» está cerrado hasta eso).
function cardFromSearch(p) {
  const sp = p.specs || {};
  const mm = (v) => (v == null ? "" : `${v} mm`);
  return {
    sku: p.model || p.title, name: p.title, brand: p.brand,
    brand_slug: String(p.brand || "").toLowerCase().replace(/\s+/g, "-"),
    price: p.price, medusaId: p.product_id,
    colors: (p.variants || []).map((v) => ({ name: v.color || v.title, image: v.image })),
    attributes: {
      shape: sp.shape, material: sp.material, gender: sp.gender, age: sp.age_group, rim: sp.rim,
      eye_size: mm(sp.eye), bridge_size: mm(sp.bridge), temple_length: mm(sp.temple), lens_height: mm(sp.lens_height),
    },
  };
}

function Mini() {
  const [lines, setLines] = useState([]);
  const [card, setCard] = useState(null);
  const mode = new URLSearchParams(location.search).get("mode") === "dark" ? "dark" : "light";
  const m = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const addFrame = (p, v) => setLines([{ key: `${v.id}-1`, kind: "frame", variant_id: v.id, ...frameLineFields(p, v) }]);
  return (
    <div className="adm-shell" data-mode={mode} style={{ padding: 24, maxWidth: 820 }}>
      <PosFrameSearch storeId="est_02" money={m} onAdd={addFrame} onView={(p) => setCard(cardFromSearch(p))} />
      {card && <AdminFrameCard product={card} onClose={() => setCard(null)} />}
      <ul className="pos-lines">
        {lines.map((l) => (
          <li key={l.key} className="pos-line-card">
            <PosFrameCard frame={l} money={m} onRemove={() => setLines([])}
              onChangeColor={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, variant_id: v.id, variant_title: v.title, color: v.color ?? v.title, sku: v.sku ?? null, barcode: v.barcode ?? null, image: v.image || x.images?.[0] || null } : x)))} />
          </li>
        ))}
      </ul>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<LanguageProvider><FeedbackProvider><Boundary><App /></Boundary></FeedbackProvider></LanguageProvider>);
