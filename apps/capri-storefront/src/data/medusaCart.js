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

export async function listShippingOptions() {
  const id = readId();
  if (!id) return [];
  const { shipping_options } = await medusa.store.fulfillment.listCartOptions({ cart_id: id });
  return shipping_options || [];
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

/**
 * Record that payment was confirmed for `cartId` but the order is not created
 * yet. Stores only the cart id + a timestamp — never any card or PHI data.
 */
export function markPaymentConfirmed(cartId) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ cart_id: cartId, ts: Date.now() }));
  } catch { /* storage unavailable — recovery falls back to the active cart id */ }
}

/** Read the pending-order marker, or null when there is none. */
export function getPendingOrder() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Clear the pending-order marker (order confirmed, or the flow was abandoned). */
export function clearPendingOrder() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* no-op */ }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Complete the cart → order with retry + exponential backoff, idempotently.
 *
 * `cartId` defaults to the active cart id; recovery passes the id saved in the
 * pending marker (which survives writeId(null)). Returns one of:
 *   { ok: true,  order }                — order created (or already existed)
 *   { ok: false, pending: true, error } — payment was confirmed but the order
 *                                         could not be confirmed after retries;
 *                                         the marker is KEPT so a later load or
 *                                         the backend reconciliation subscriber
 *                                         can still finish it
 *   { ok: false, error: "no_cart" }     — nothing to complete
 *
 * Both in-band completion errors (res.type !== "order", e.g. the payment session
 * not yet authorized right after Stripe) and thrown errors (network / 5xx) are
 * treated as transient and retried; only after exhausting retries do we report
 * `pending` and leave the marker in place.
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
      // Thrown → network / timeout / 5xx. Transient by assumption.
      lastErr = (e && e.message) || String(e);
    }
    // Backoff between attempts: 0.8s, 1.6s, 3.2s, 6.4s (no wait after the last).
    if (attempt < retries) await sleep(baseDelay * Math.pow(2, attempt));
  }
  // Money is committed but no order surfaced. Preserve the marker for recovery.
  return { ok: false, pending: true, error: lastErr };
}

export function clearCartId() { writeId(null); }
