// Dónde se usa: pestaña Costos de /admin — reglas de costo (fichas por marca,
// lente, laboratorio, comisiones…), ficha por pedido y rentabilidad
// (backend: /admin/costing/*). Sin hook de idioma: claves, nunca prosa.
import { adminFetch } from "./adminApi.js";

export const fetchCostRules = () => adminFetch("/admin/costing/rules");
export const saveCostRules = (rules) => adminFetch("/admin/costing/rules", { method: "PUT", body: { rules } });
export const deleteCostRule = (id) => adminFetch(`/admin/costing/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
export const fetchOrderCost = (orderId) => adminFetch(`/admin/costing/orders/${encodeURIComponent(orderId)}`);
export const saveOrderCost = (orderId, lines) => adminFetch(`/admin/costing/orders/${encodeURIComponent(orderId)}`, { method: "PUT", body: { lines } });
export const resetOrderCost = (orderId) => adminFetch(`/admin/costing/orders/${encodeURIComponent(orderId)}`, { method: "PUT", body: { reset: true } });
export const fetchCostSummary = ({ from = "", to = "", seller = "" } = {}) => adminFetch("/admin/costing/summary", { query: { from, to, seller } });

/** Grupos de reglas tal como se presentan (clave de diccionario + kinds). */
export const RULE_GROUPS = [
  { key: "frames", kinds: ["frame_brand", "frame_sku"], icon: "glasses" },
  { key: "lenses", kinds: ["lens_design", "lens_material", "lens_photo", "lens_ar"], icon: "layers" },
  { key: "order", kinds: ["order_fixed", "shipping"], icon: "box" },
  { key: "fees", kinds: ["order_percent", "payment_fixed"], icon: "percent", only: ["payment_fee", "payment_fee_fixed"] },
];
/** Claves de porcentaje que NO son "distribución" (van en Comisiones de pago). */
export const FEE_KEYS = ["payment_fee", "payment_fee_fixed"];
export const PROFIT_TARGET_KEY = "profit_target";
/** Reglas de distribución por porcentaje (renta, atención al cliente, webmaster, impuestos…). */
export const isAllocationRule = (r) => r.kind === "order_percent" && !FEE_KEYS.includes(r.match_key) && r.match_key !== PROFIT_TARGET_KEY;
export const isProfitTarget = (r) => r.kind === "order_percent" && r.match_key === PROFIT_TARGET_KEY;
/** Plantillas sugeridas al crear la distribución (claves de diccionario). */
export const ALLOCATION_SUGGESTIONS = ["customer_service", "rent", "webmaster", "taxes", "marketing", "other"];

/** Semáforo de margen: ≥40 % sano, 20–40 % justo, <20 % alerta. */
export function marginTone(pct) {
  if (pct == null || Number.isNaN(pct)) return "mid";
  if (pct >= 40) return "good";
  if (pct >= 20) return "mid";
  return "bad";
}
