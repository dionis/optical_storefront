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
  stores: [{ id: "est_02", code: "Op2", name: "Fry Family", color: "#2e7d5b", currency: "usd",
    payment_methods: ["cash", "card", "zelle"], terminals: [{ id: "t1", name: "Caja 1" }] }],
  payment_methods: [{ code: "cash", label: "Efectivo" }, { code: "card", label: "Tarjeta" }, { code: "zelle", label: "Zelle" }],
};
window.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/admin/pos/context")) return json(CTX);
  if (url.includes("/admin/pos/customers")) return json({ customers: [] });
  if (url.includes("/admin/pos/quote")) return json({ lines: [], totals: { subtotal: 50.97, tax: 0, total: 50.97 } });
  if (url.includes("/admin/pos/products")) {
    const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [])[1] || "").toLowerCase();
    return json({ products: PRODUCTS.filter((p) => !q || p.title.toLowerCase().includes(q)) });
  }
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
  if (screen === "sale") return <PosSale me={ME} />;
  // ?screen=card monta SOLO la ficha de montura (el modal del ojo del buscador).
  if (screen === "card") return <CardOnly />;
  return <Mini />;
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
