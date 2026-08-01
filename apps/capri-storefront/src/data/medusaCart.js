// Medusa cart + checkout flow (Phase 5). New module, used by CartContext and the
// checkout UI when USE_MEDUSA is on. Only the cart_id is persisted locally; the cart
// (line items, totals, shipping, payment) lives server-side. Prices are decimal
// dollars (Medusa v2) — never cents. Lens configuration is priced server-side via
// the /store/carts/:id/configured-line route (the client never sends a total).
import { medusa } from "./medusa.js";

const CART_KEY = "oer_medusa_cart";

// Default payment provider — switchable without code changes (Stripe/PayPal/Square).
export const DEFAULT_PROVIDER =
  (import.meta.env && import.meta.env.VITE_DEFAULT_PAYMENT_PROVIDER) || "pp_stripe_stripe";

const CART_FIELDS =
  "id,email,currency_code,region_id,total,item_total,shipping_total,tax_total,completed_at," +
  "items.id,items.title,items.quantity,items.unit_price,items.total,items.thumbnail,items.metadata," +
  "shipping_methods.id,shipping_methods.amount,shipping_address.*";

let regionIdCache = null;
async function regionId() {
  if (regionIdCache) return regionIdCache;
  const { regions } = await medusa.store.region.list();
  regionIdCache = regions && regions[0] && regions[0].id;
  return regionIdCache;
}

const readId = () => { try { return localStorage.getItem(CART_KEY) || null; } catch { return null; } };
const writeId = (id) => { try { id ? localStorage.setItem(CART_KEY, id) : localStorage.removeItem(CART_KEY); } catch {} };

/** Get the active cart, creating a fresh one if none/expired/already completed. */
export async function ensureCart() {
  const id = readId();
  if (id) {
    try {
      const { cart } = await medusa.store.cart.retrieve(id, { fields: CART_FIELDS });
      if (cart && !cart.completed_at) return cart;
    } catch { /* fall through to create */ }
  }
  const { cart } = await medusa.store.cart.create({ region_id: await regionId() }, { fields: CART_FIELDS });
  writeId(cart.id);
  return cart;
}

export async function getCart() {
  const id = readId();
  if (!id) return null;
  try {
    const { cart } = await medusa.store.cart.retrieve(id, { fields: CART_FIELDS });
    return cart && !cart.completed_at ? cart : null;
  } catch { return null; }
}

/**
 * Persist a prescription as a health record (PHI) server-side. Returns its id; the
 * raw Rx values never touch the cart, order metadata, or localStorage.
 */
export async function createPrescription(prescription, ctx = {}) {
  const res = await medusa.client.fetch("/store/prescriptions", {
    method: "POST",
    body: { prescription, usage_type: ctx.usage_type, eye_size: ctx.eye_size },
  });
  return res.prescription_id || null;
}

/**
 * Read a prescription photo via the backend OCR endpoint. The file is uploaded
 * as multipart and never touches R2 from the browser — the backend owns the
 * private PHI bucket. Returns { prescription, validation, message }; the
 * prescription always comes back with verified_by_user=false, so the caller
 * must have the user confirm the values before persisting them.
 */
export async function ocrPrescription(file) {
  const form = new FormData();
  form.append("file", file);
  return medusa.client.fetch("/store/prescriptions/ocr", {
    method: "POST",
    body: form,
    // The SDK defaults to application/json and would JSON.stringify the
    // FormData; dropping the header lets the browser set the multipart
    // boundary itself.
    headers: { "content-type": null },
  });
}

/** Add a frame configured with lenses — priced entirely server-side. */
export async function addConfiguredFrame(variantId, selection, prescriptionId = null) {
  const cart = await ensureCart();
  const res = await medusa.client.fetch(`/store/carts/${cart.id}/configured-line`, {
    method: "POST",
    body: { variant_id: variantId, selection, prescription_id: prescriptionId },
  });
  return res.cart;
}

/** Add a plain variant (frame at base price, or a case) at its own server price. */
export async function addVariant(variantId, quantity = 1) {
  const cart = await ensureCart();
  const { cart: updated } = await medusa.store.cart.createLineItem(
    cart.id, { variant_id: variantId, quantity }, { fields: CART_FIELDS }
  );
  return updated;
}

export async function removeItem(lineItemId) {
  const id = readId();
  if (!id) return null;
  await medusa.store.cart.deleteLineItem(id, lineItemId);
  return getCart();
}

export async function updateContact({ email, shipping_address }) {
  const id = readId();
  if (!id) return null;
  const body = {};
  if (email) body.email = email;
  if (shipping_address) body.shipping_address = shipping_address;
  const { cart } = await medusa.store.cart.update(id, body, { fields: CART_FIELDS });
  return cart;
}

// Requirement 14: the storefront is delivery-only — never surface a
// "pick up in store" option. We drop any shipping option that looks like a
// pickup/collection method (by fulfillment type, metadata flag, or name in
// either language) so the customer can only choose home delivery.
function isPickupOption(o) {
  if (!o) return false;
  const md = o.metadata || {};
  if (md.pickup === true || md.is_pickup === true) return true;
  const typeCode = (o.type && (o.type.code || o.type.label)) || "";
  const hay = `${o.name || ""} ${typeCode} ${md.type || ""}`.toLowerCase();
  return /pickup|pick[- ]?up|recoger|recogida|en tienda|in[- ]?store|collect/.test(hay);
}

export async function listShippingOptions() {
  const id = readId();
  if (!id) return [];
  const { shipping_options } = await medusa.store.fulfillment.listCartOptions({ cart_id: id });
  return (shipping_options || []).filter((o) => !isPickupOption(o));
}

export async function setShippingMethod(optionId) {
  const id = readId();
  const { cart } = await medusa.store.cart.addShippingMethod(id, { option_id: optionId }, { fields: CART_FIELDS });
  return cart;
}

/**
 * Initialize the payment session with the chosen provider. Returns the Stripe
 * PaymentIntent client_secret (for Stripe.js) plus the payment collection.
 */
export async function startPayment(providerId = DEFAULT_PROVIDER) {
  const id = readId();
  const { cart } = await medusa.store.cart.retrieve(id, { fields: CART_FIELDS });
  const { payment_collection } = await medusa.store.payment.initiatePaymentSession(cart, {
    provider_id: providerId,
  });
  const session = (payment_collection.payment_sessions || []).find((s) => s.provider_id === providerId);
  return { clientSecret: session?.data?.client_secret || null, paymentCollection: payment_collection, providerId };
}

/** Complete the cart → order (after the browser confirms payment). Clears the cart id. */
export async function completeCart() {
  const id = readId();
  const res = await medusa.store.cart.complete(id);
  if (res.type === "order") { writeId(null); return { ok: true, order: res.order }; }
  return { ok: false, error: res.error || res };
}

// ── Payment-confirmed / order-pending recovery (ORDEN 6) ──────────────────────
// There is an unavoidable gap between two events: Stripe confirming the charge
// (the customer's money is committed) and the backend turning the cart into an
// order via cart.complete(). A network blip, a 5xx, or the browser closing in
// that window would otherwise strand a paying customer with no order and no
// trace. To close that gap we:
//   1. persist a marker the instant payment is confirmed (markPaymentConfirmed),
//   2. retry completion with exponential backoff (completeCartWithRetry), and
//   3. recover on the next page load by re-attempting completion.
// This is safe because Medusa's cart.complete() is idempotent: completing an
// already-completed cart returns the SAME order rather than charging again — so
// re-attempts can never double-charge or duplicate the order.
const PENDING_KEY = "oer_pending_order";
// A marker older than this is considered stale and ignored, so an old,
// unrecoverable attempt can never brick checkout for a brand-new purchase.
// (The backend reconciliation subscriber is the source of truth for any
// captured-but-uncompleted payment; this marker is only a client convenience.)
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Record that payment was confirmed for `cartId` but the order is not created
 * yet. Stores only the cart id + a timestamp — never any card or PHI data.
 */
export function markPaymentConfirmed(cartId = readId()) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ cart_id: cartId, ts: Date.now() }));
  } catch { /* storage unavailable — recovery falls back to the active cart id */ }
}

/**
 * Read the pending-order marker, or null when there is none. A marker without a
 * usable cart_id, or one older than PENDING_MAX_AGE_MS, is treated as absent and
 * cleared — this prevents a stale/unrecoverable marker from trapping the user on
 * the "confirming your order" screen forever.
 */
export function getPendingOrder() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (!m || !m.cart_id || (m.ts && Date.now() - m.ts > PENDING_MAX_AGE_MS)) {
      clearPendingOrder();
      return null;
    }
    return m;
  } catch { return null; }
}

/** Clear the pending-order marker (order confirmed, or the flow was abandoned). */
export function clearPendingOrder() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* no-op */ }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A thrown 4xx means the request itself won't succeed on retry (cart not found,
 * validation/business error) — retrying is pointless and would only loop. 5xx,
 * timeouts and network errors carry no status (or >= 500) and are transient.
 */
function isTerminalError(e) {
  const status = e && (e.status || (e.response && e.response.status));
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * Complete the cart → order with retry + exponential backoff, idempotently.
 *
 * `cartId` defaults to the active cart id; recovery passes the id saved in the
 * pending marker (which survives writeId(null)). Returns one of:
 *   { ok: true,  order }                 — order created (or already existed)
 *   { ok: false, pending: true, error }  — payment confirmed but the order could
 *                                          not be confirmed after retries; the
 *                                          marker is KEPT so a later load or the
 *                                          backend reconciliation subscriber can
 *                                          still finish it
 *   { ok: false, terminal: true, error } — a non-retryable 4xx (e.g. the cart no
 *                                          longer exists). The caller decides
 *                                          whether to clear the marker; this fn
 *                                          does NOT, so a genuinely captured
 *                                          payment is never silently forgotten.
 *   { ok: false, error: "no_cart" }      — nothing to complete
 *
 * In-band completion errors (res.type !== "order", e.g. the payment session not
 * yet authorized right after Stripe) and thrown 5xx/network errors are treated
 * as transient and retried; only after exhausting retries do we report `pending`.
 */
export async function completeCartWithRetry(cartId = readId(), { retries = 4, baseDelay = 800 } = {}) {
  if (!cartId) return { ok: false, error: "no_cart" };
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await medusa.store.cart.complete(cartId);
      if (res.type === "order") {
        writeId(null);          // the cart became an order — drop the cart id
        clearPendingOrder();    // …and the recovery marker
        return { ok: true, order: res.order };
      }
      // In-band failure (commonly "payment not authorized yet" in the seconds
      // after Stripe confirmation). Keep the reason and retry with backoff.
      lastErr = res.error || res;
    } catch (e) {
      if (isTerminalError(e)) {
        // 4xx — the cart can't be completed (not found / invalid). Stop now and
        // let the caller decide about the marker (recovery clears it to break
        // the loop; pay() keeps it since the payment was just captured).
        return { ok: false, terminal: true, error: (e && e.message) || String(e) };
      }
      // Thrown 5xx / timeout / network → transient by assumption.
      lastErr = (e && e.message) || String(e);
    }
    // Backoff between attempts: 0.8s, 1.6s, 3.2s, 6.4s (no wait after the last).
    if (attempt < retries) await sleep(baseDelay * Math.pow(2, attempt));
  }
  // Money is committed but no order surfaced. Preserve the marker for recovery.
  return { ok: false, pending: true, error: lastErr };
}

export function clearCartId() { writeId(null); }
