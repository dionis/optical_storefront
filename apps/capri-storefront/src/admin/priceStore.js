// Price overrides set by the store owner from the admin panel.
// The storefront reads these and applies them ON TOP of the base (deterministic) prices,
// so the owner can edit EVERY price: frames (per SKU), lens materials, treatments, lens
// usage/types, shipping, and accessories/cases (per SKU).
// Persisted in localStorage + export/import JSON. For SaaS, persist via backend (this
// module is the single seam — swap load()/save() for API calls).
const KEY = "oer_price_overrides";

const DEFAULT_SHIPPING = {
  standard: 4.95, express: 12.95, freeThreshold: 59,
  // pickup in store (configurable). Default: main branch on Fry Rd, Katy.
  pickup: {
    enabled: true,
    name: "Óptica El Rancho",
    address: "Fry Rd, Katy, TX 77449",
    city: "Katy, Texas",
    hours: "Lun–Sáb 9:00–19:00",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Optica+El+Rancho+Fry+Rd+Katy+TX",
  },
  // ship-from origin used to estimate delivery
  origin: { name: "Óptica El Rancho (Fry Rd)", address: "Fry Rd, Katy, TX 77449", city: "Katy, TX" },
  carriers: ["FedEx", "UPS", "USPS", "DHL", "Consignataria"],
  // configurable shipping zones (destino → transportista, costo y tiempo estimado en días)
  zones: [
    { id: "us", name: "Estados Unidos", carrier: "USPS/UPS", cost: 6.95, etaMin: 3, etaMax: 6 },
    { id: "us-exp", name: "EE.UU. exprés", carrier: "FedEx", cost: 19.95, etaMin: 1, etaMax: 2 },
    { id: "mx", name: "México", carrier: "DHL", cost: 24.95, etaMin: 5, etaMax: 10 },
    { id: "latam", name: "Latinoamérica", carrier: "DHL/FedEx", cost: 34.95, etaMin: 7, etaMax: 14 },
    { id: "cuba", name: "Cuba", carrier: "Consignataria (Va Cuba/Cubamax)", cost: 49.95, etaMin: 10, etaMax: 21 },
    { id: "intl", name: "Resto del mundo", carrier: "DHL/FedEx", cost: 39.95, etaMin: 7, etaMax: 15 },
  ],
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} bump(); }

const subs = new Set();
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
function bump() { for (const f of subs) f(); }

export function getOverrides() {
  const o = load();
  return {
    frames: o.frames || {},
    cases: o.cases || {},
    materials: o.materials || {},
    treatments: o.treatments || {},
    usage: o.usage || {},
    shipping: { ...DEFAULT_SHIPPING, ...(o.shipping || {}) },
  };
}

function setIn(group, key, value) {
  const o = load();
  o[group] = o[group] || {};
  if (value === "" || value == null || Number.isNaN(Number(value))) delete o[group][key];
  else o[group][key] = Math.round(Number(value) * 100) / 100;
  save(o);
}
export const setFramePrice = (sku, v) => setIn("frames", sku, v);
export const setCasePrice = (sku, v) => setIn("cases", sku, v);
export const setMaterialPrice = (k, v) => setIn("materials", k, v);
export const setTreatmentPrice = (k, v) => setIn("treatments", k, v);
export const setUsagePrice = (k, v) => setIn("usage", k, v);

export function setShipping(patch) {
  const o = load();
  o.shipping = { ...DEFAULT_SHIPPING, ...(o.shipping || {}), ...patch };
  save(o);
}
export function setPickup(patch) {
  const o = load(); const sh = { ...DEFAULT_SHIPPING, ...(o.shipping || {}) };
  o.shipping = { ...sh, pickup: { ...DEFAULT_SHIPPING.pickup, ...(sh.pickup || {}), ...patch } };
  save(o);
}
export function setOrigin(patch) {
  const o = load(); const sh = { ...DEFAULT_SHIPPING, ...(o.shipping || {}) };
  o.shipping = { ...sh, origin: { ...DEFAULT_SHIPPING.origin, ...(sh.origin || {}), ...patch } };
  save(o);
}
function getZones() { const sh = { ...DEFAULT_SHIPPING, ...(load().shipping || {}) }; return Array.isArray(sh.zones) ? sh.zones : DEFAULT_SHIPPING.zones; }
function saveZones(zones) { const o = load(); o.shipping = { ...DEFAULT_SHIPPING, ...(o.shipping || {}), zones }; save(o); }
export function addZone() {
  const zones = getZones().slice();
  zones.push({ id: "z" + Date.now(), name: "Nueva zona", carrier: "FedEx", cost: 0, etaMin: 5, etaMax: 10 });
  saveZones(zones);
}
export function updateZone(id, patch) {
  saveZones(getZones().map((z) => (z.id === id ? { ...z, ...patch } : z)));
}
export function removeZone(id) { saveZones(getZones().filter((z) => z.id !== id)); }

export function resetAll() { try { localStorage.removeItem(KEY); } catch {} bump(); }

// ---- appliers used by the storefront ----
export function applyFrame(sku, base) { const o = load().frames || {}; return sku in o ? o[sku] : base; }
export function applyCase(sku, base) { const o = load().cases || {}; return sku in o ? o[sku] : base; }
export function materialPrice(key, base) { const o = load().materials || {}; return key in o ? o[key] : base; }
export function treatmentPrice(key, base) { const o = load().treatments || {}; return key in o ? o[key] : base; }
export function usagePrice(key, base) { const o = load().usage || {}; return key in o ? o[key] : base; }
export function shipping() { return { ...DEFAULT_SHIPPING, ...(load().shipping || {}) }; }

// ---- export / import ----
export function exportJSON() {
  const blob = new Blob([JSON.stringify(load(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "precios-oer.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function importJSON(text) {
  const data = JSON.parse(text);
  if (typeof data !== "object" || !data) throw new Error("JSON inválido");
  save(data);
}
