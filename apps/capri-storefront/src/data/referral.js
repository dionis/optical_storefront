// Dónde se usa: App.jsx (captura `?ref=CODIGO` del enlace de un vendedor),
// MedusaCheckout.jsx (lo manda en `cart.metadata.seller_code`) y la página
// pública /vendedor (panel del vendedor por enlace firmado).
//
// El código vive 30 días en localStorage: el cliente puede llegar hoy por el
// enlace de Instagram y comprar la semana que viene, y la venta sigue siendo
// de quien la trajo. Nunca se manda nada más que el código.
import { MEDUSA_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa.js";

const KEY = "rl_ref";
const TTL_MS = 30 * 864e5;

export function captureReferral(search) {
  try {
    const code = (new URLSearchParams(search || "").get("ref") || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(code)) return null;
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
    return code;
  } catch { return null; }
}

export function getReferral() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || !raw.code) return null;
    if (Date.now() - (raw.at || 0) > TTL_MS) { localStorage.removeItem(KEY); return null; }
    return raw.code;
  } catch { return null; }
}

async function call(path) {
  const headers = {};
  if (MEDUSA_PUBLISHABLE_KEY) headers["x-publishable-api-key"] = MEDUSA_PUBLISHABLE_KEY;
  const res = await fetch(`${MEDUSA_URL}${path}`, { headers });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) { const e = new Error(payload?.message || `HTTP ${res.status}`); e.status = res.status; e.reason = payload?.reason; throw e; }
  return payload;
}

/** Panel del vendedor: ventas atribuidas a su código (sin datos de clientes). */
export function fetchSellerDashboard(token, { from = "", to = "" } = {}) {
  const q = new URLSearchParams({ token });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return call(`/store/seller-dashboard?${q.toString()}`);
}
