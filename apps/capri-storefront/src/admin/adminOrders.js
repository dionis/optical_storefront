// Real orders for the corporate panel, straight from the Medusa Admin API.
//
// This replaces the localStorage layer the Orders tab used to read
// (analytics.js `allOrders` / `updateOrderStatus`), which was seeded demo data
// that no real checkout ever wrote to — moving a row there changed nothing for
// anybody. Everything here is server state.
//
// The vocabulary is deliberately the backend's: `stage` is what
// `deriveOrderProgress` computed, `next_stages` is what the server will actually
// accept. The panel renders those and nothing else, so a button can never offer
// a transition the API will refuse.

import { adminFetch } from "./adminApi.js";

/**
 * Stage presentation. Keys and order MUST match ORDER_STAGES in
 * apps/backend/src/lib/order-status.ts and STEPS in TrackingTimeline.jsx — the
 * three are one timeline seen from three places, and the icons are shared with
 * the customer's view on purpose so the owner reads the same picture.
 */
export const STAGES = [
  { key: "confirmed", icon: "🧾", label: "Confirmado", color: "#7a5cff", bg: "#efeaff" },
  { key: "in_lab", icon: "🔬", label: "En laboratorio", color: "#b26a00", bg: "#fff3e0" },
  { key: "shipped", icon: "🏷️", label: "Preparado", color: "#0b6bcb", bg: "#e7f1ff" },
  { key: "in_transit", icon: "🚚", label: "En camino", color: "#0b6bcb", bg: "#e7f1ff" },
  { key: "delivered", icon: "✅", label: "Entregado", color: "#2e7d46", bg: "#e9f5ee" },
];

export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));

/** States that end the timeline instead of advancing it. */
export const TERMINALS = [
  { key: "payment_pending", icon: "⏳", label: "Pago pendiente", color: "#8a6d00", bg: "#fff8e1" },
  { key: "canceled", icon: "⚠️", label: "Cancelado", color: "#b3261e", bg: "#fdecea" },
  { key: "refunded", icon: "↩️", label: "Reembolsado", color: "#b3261e", bg: "#fdecea" },
];

export const TERMINAL_BY_KEY = Object.fromEntries(TERMINALS.map((s) => [s.key, s]));

/** What the owner is promising the customer by clicking each transition. */
export const STAGE_ACTION = {
  confirmed: "Quitar la marca de laboratorio y dejarlo como confirmado.",
  in_lab: "Marcar que las lentes entraron en producción.",
  shipped: "Crear la preparación del pedido (descuenta stock).",
  in_transit: "Registrar la entrega al transportista y avisar al cliente.",
  delivered: "Marcar como entregado al cliente.",
};

/**
 * One page of the board.
 *
 * Note that `count` is the number of matches **within the window the server
 * scanned**, not the number of orders in the database. Stage is derived rather
 * than stored, so it cannot be filtered in SQL; the server reads a bounded slice
 * of recent orders and filters those. `truncated` says when that slice was full,
 * and the UI has to surface it — silently paginating over a partial answer is
 * how an owner concludes an order "disappeared".
 */
export async function fetchOrders({
  q = "",
  from = "",
  to = "",
  stage = "",
  terminal = "",
  hasPrescription = "",
  limit = 20,
  offset = 0,
} = {}) {
  return adminFetch("/admin/order-board", {
    query: {
      q: q.trim(),
      from,
      to,
      stage,
      terminal,
      has_prescription: hasPrescription,
      limit,
      offset,
    },
  });
}

/**
 * Move one order to `stage`.
 *
 * The server does the translation into Medusa's actual operations (metadata
 * note, fulfillment, shipment, delivery) and answers with the re-read order, so
 * the caller repaints from the truth rather than from what it hoped happened.
 */
export async function setOrderStage(id, stage, { trackingNumber = "", noNotification = false } = {}) {
  const data = await adminFetch(`/admin/order-board/${encodeURIComponent(id)}/stage`, {
    method: "POST",
    body: {
      stage,
      tracking_number: trackingNumber || undefined,
      no_notification: noNotification || undefined,
    },
  });
  return data?.order ?? null;
}

/** Money arrives from Medusa in minor units; the panel shows currency. */
export function money(amount, currency = "usd") {
  const value = Number(amount || 0);
  try {
    return new Intl.NumberFormat("es", {
      style: "currency",
      currency: String(currency || "usd").toUpperCase(),
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${String(currency).toUpperCase()}`;
  }
}

/** `#1042` when Medusa assigned a display id, the opaque id otherwise. */
export function orderLabel(order) {
  return order?.display_id ? `#${order.display_id}` : String(order?.id ?? "").slice(-8);
}
