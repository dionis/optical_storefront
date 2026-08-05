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
 *
 * `label` and `action` are dictionary KEYS, not words: this module has no
 * language hook, so it carries the icon and the colours (which are the same in
 * every language) and leaves the wording to whoever renders. `action` is the
 * promise the owner is making to the customer by clicking the button.
 */
export const STAGES = [
  { key: "confirmed", icon: "🧾", label: "adm.stage.confirmed", action: "adm.stage.act.confirmed", color: "#7a5cff", bg: "#efeaff" },
  { key: "in_lab", icon: "🔬", label: "adm.stage.in_lab", action: "adm.stage.act.in_lab", color: "#b26a00", bg: "#fff3e0" },
  { key: "shipped", icon: "🏷️", label: "adm.stage.shipped", action: "adm.stage.act.shipped", color: "#0b6bcb", bg: "#e7f1ff" },
  { key: "in_transit", icon: "🚚", label: "adm.stage.in_transit", action: "adm.stage.act.in_transit", color: "#0b6bcb", bg: "#e7f1ff" },
  { key: "delivered", icon: "✅", label: "adm.stage.delivered", action: "adm.stage.act.delivered", color: "#2e7d46", bg: "#e9f5ee" },
];

export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));

/** States that end the timeline instead of advancing it. */
export const TERMINALS = [
  { key: "payment_pending", icon: "⏳", label: "adm.term.payment_pending", color: "#8a6d00", bg: "#fff8e1" },
  { key: "canceled", icon: "⚠️", label: "adm.term.canceled", color: "#b3261e", bg: "#fdecea" },
  { key: "refunded", icon: "↩️", label: "adm.term.refunded", color: "#b3261e", bg: "#fdecea" },
];

export const TERMINAL_BY_KEY = Object.fromEntries(TERMINALS.map((s) => [s.key, s]));

/**
 * Turn a failed admin call into text in the owner's language.
 *
 * The backend answers with a `reason` code precisely so it never has to guess
 * which language the panel is in. When the code is one we know, the dictionary
 * wins. When it is not — an unexpected 500, a bug — the server's own English
 * note is shown verbatim rather than swallowed behind a generic phrase that
 * would leave nobody anything to debug with.
 */
export function stageErrorText(t, error, fallbackKey = "adm.ord.moveFailed") {
  const key = error?.reason ? `adm.err.stage.${error.reason}` : null;
  if (key) {
    const text = t(key);
    if (text !== key) return text;
  }
  // adminApi throws dictionary keys for its own failures (offline, expired).
  if (typeof error?.message === "string" && error.message.startsWith("adm.")) {
    return t(error.message);
  }
  return error?.message || t(fallbackKey);
}

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

/**
 * Money, formatted for the language the owner picked.
 *
 * The locale is a parameter rather than a constant because number and currency
 * conventions are part of the interface: "1.234,56 US$" and "$1,234.56" are the
 * same amount, and a panel that stays Spanish-formatted after switching to
 * English is only half translated.
 */
export function money(amount, currency = "usd", lang = "es") {
  const value = Number(amount || 0);
  try {
    return new Intl.NumberFormat(lang === "en" ? "en-US" : "es", {
      style: "currency",
      currency: String(currency || "usd").toUpperCase(),
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${String(currency).toUpperCase()}`;
  }
}

/** Dates follow the language for the same reason money does. */
export function shortDate(value, lang = "es") {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(lang === "en" ? "en-US" : "es");
}

/** `#1042` when Medusa assigned a display id, the opaque id otherwise. */
export function orderLabel(order) {
  return order?.display_id ? `#${order.display_id}` : String(order?.id ?? "").slice(-8);
}
