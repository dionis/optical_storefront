// Passwordless access to a shopper's own orders.
//
// Checkout is guest-only, so there is no Medusa customer session to reuse.
// Identity here is "proved control of an email address": the backend mails a
// short-lived link, redeeming it returns a long-lived session token, and we keep
// that token so the shopper never has to open their inbox again — which is the
// whole point of the feature.
//
// The token is the only credential, so it is scoped to this browser via
// localStorage. It grants read access to order status only; the backend never
// sends prescription values over this channel (see src/api/store/my-orders).
import { MEDUSA_URL, MEDUSA_PUBLISHABLE_KEY } from "./medusa.js";

const KEY = "oer_order_access";

/** Reads the stored session, dropping it once the backend's TTL has passed. */
export function getSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || !raw.token) return null;
    if (raw.expires_at && Date.now() > raw.expires_at) {
      localStorage.removeItem(KEY);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function setSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* private browsing — the session just won't survive the reload */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

async function call(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (MEDUSA_PUBLISHABLE_KEY) headers["x-publishable-api-key"] = MEDUSA_PUBLISHABLE_KEY;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${MEDUSA_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = new Error((payload && payload.message) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

/**
 * Ask for a magic link. Always resolves — the backend answers identically
 * whether or not the address has orders, so the UI must not promise that a mail
 * is on its way to *this* address specifically.
 */
export function requestMagicLink(email, locale) {
  return call("/store/order-access/request", {
    method: "POST",
    body: { email, locale },
  });
}

/** Redeem the token from the emailed link and persist the resulting session. */
export async function redeemMagicToken(token) {
  const data = await call("/store/order-access/verify", {
    method: "POST",
    body: { token },
  });
  const session = {
    token: data.token,
    email: data.email,
    expires_at: Date.now() + (data.expires_in || 0),
  };
  setSession(session);
  return session;
}

/** Every order for the session's address, newest first. */
export async function fetchMyOrders() {
  const session = getSession();
  if (!session) return null;
  try {
    return await call("/store/my-orders", { token: session.token });
  } catch (e) {
    // A rejected token is spent — drop it so the UI falls back to asking for a
    // fresh link instead of looping on 401s.
    if (e.status === 401) clearSession();
    throw e;
  }
}

/** Raise an issue about one order (delay, something wrong, cancellation). */
export function sendSupportMessage({ orderId, reason, message, locale }) {
  const session = getSession();
  if (!session) throw new Error("no-session");
  return call("/store/order-support", {
    method: "POST",
    token: session.token,
    body: { order_id: orderId, reason, message, locale },
  });
}
