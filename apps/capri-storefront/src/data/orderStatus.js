// ─────────────────────────────────────────────────────────────────────────
// Estados de una orden — FUENTE DE VERDAD ÚNICA (cliente + tienda).
//
// Todo lo relacionado con el seguimiento del pedido (línea de tiempo del
// cliente, badge de "Mi cuenta", panel del admin, valor por defecto al crear
// la orden y los datos demo) importa de AQUÍ. Cambiar un estado o su etiqueta
// en este arreglo se propaga a los dos lados a la vez, evitando que el cliente
// y el admin usen vocabularios distintos.
//
// Flujo del negocio (óptica con fabricación en laboratorio):
//   recibida → en fabricación → enviada → en tránsito → entregada
//
// NOTA de arquitectura: las órdenes viven en localStorage (por navegador). El
// estado que el dueño cambia en SU navegador no llega solo al del cliente; para
// un seguimiento realmente bilateral hace falta persistir las órdenes en el
// backend (Medusa) y leerlas por API. Este módulo deja el modelo listo para
// ese día — solo habría que cambiar la capa de lectura/escritura en analytics.js.
// ─────────────────────────────────────────────────────────────────────────

/** Lista ordenada de estados. `icon`/`color`/`bg` los usa el badge del admin. */
export const ORDER_STATUS = [
  { key: "received",      icon: "🧾", color: "#0E5AD0", bg: "#eaf2ff", es: "Recibida",        en: "Received" },
  { key: "manufacturing", icon: "🛠️", color: "#b26a00", bg: "#fbf0df", es: "En fabricación",  en: "In production" },
  { key: "shipped",       icon: "🏷️", color: "#7b4aa0", bg: "#f1e9f7", es: "Enviada",         en: "Shipped" },
  { key: "in_transit",    icon: "🚚", color: "#5a3fb0", bg: "#eee9fb", es: "En tránsito",      en: "In transit" },
  { key: "delivered",     icon: "✅", color: "#2e7d46", bg: "#e9f5ee", es: "Entregada",        en: "Delivered" },
];

/** Solo las claves, en orden. */
export const ORDER_STATUS_KEYS = ORDER_STATUS.map((s) => s.key);

/** Estado con el que nace toda orden nueva. */
export const DEFAULT_ORDER_STATUS = "received";

/** Metadatos de un estado (con fallback seguro al primero si la clave no existe). */
export const orderStatusMeta = (key) => ORDER_STATUS.find((s) => s.key === key) || ORDER_STATUS[0];

/** Índice del estado en el flujo (0..n-1). Nunca devuelve -1. */
export const orderStatusIndex = (key) => {
  const i = ORDER_STATUS_KEYS.indexOf(key);
  return i < 0 ? 0 : i;
};

/** Etiqueta bilingüe del estado. `lang` = "es" | "en". */
export const orderStatusLabel = (key, lang) => {
  const m = orderStatusMeta(key);
  return (lang === "en" ? m.en : m.es) || m.es;
};

/** ¿La clave es un estado válido del flujo? (para validar antes de guardar). */
export const isValidOrderStatus = (key) => ORDER_STATUS_KEYS.includes(key);

/** ¿La orden ya está entregada? (fin del flujo). */
export const isDeliveredStatus = (key) => key === "delivered";
