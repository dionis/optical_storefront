// Medusa cart + checkout flow (Phase 5). New module, used by CartContext and the
// checkout UI when USE_MEDUSA is on. Only the cart_id is persisted locally; the cart
// (line items, totals, shipping, payment) lives server-side. Prices are decimal
// dollars (Medusa v2) — never cents. Lens configuration is priced server-side via
// the /store/carts/:id/configured-line route (the client never sends a total).
import { medusa } from "./medusa.js";
import { preparePrescriptionFile } from "../lib/imagePrep.js";

const CART_KEY = "oer_medusa_cart";

// Default payment provider — switchable without code changes (Stripe/PayPal/Square).
export const DEFAULT_PROVIDER =
  (import.meta.env && import.meta.env.VITE_DEFAULT_PAYMENT_PROVIDER) || "pp_stripe_stripe";

const CART_FIELDS =
  "id,email,currency_code,region_id,total,item_total,shipping_total,tax_total,completed_at,locale," +
  "items.id,items.title,items.quantity,items.unit_price,items.total,items.thumbnail,items.metadata," +
  "shipping_methods.id,shipping_methods.amount,shipping_address.*";

// Key LanguageContext persists the active UI language under. Read directly rather
// than through the React context: this module is plain JS called from event
// handlers, and the value is a single localStorage read either way.
const LANG_KEY = "oer_lang";

/**
 * The shopper's active language, as a locale Medusa will carry from the cart onto
 * the order. The backend reads `order.locale` to pick which language to send the
 * confirmation email in (see apps/backend/src/subscribers/order-placed.ts); `es`
 * is the store default, matching the i18n dictionary.
 */
function activeLocale() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

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
  const { cart } = await medusa.store.cart.create(
    { region_id: await regionId(), locale: activeLocale() },
    { fields: CART_FIELDS }
  );
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
 * Reduce una data URL de imagen a un tamaño razonable (JPEG) para subirla junto
 * a la receta: mantiene el objeto de R2 pequeño y evita cuerpos JSON enormes.
 * Falla en silencio devolviendo la original si algo no está disponible.
 */
function downscaleDataUrl(dataUrl, maxPx = 900, quality = 0.82) {
  return new Promise((resolve) => {
    try {
      if (typeof document === "undefined" || typeof Image === "undefined") { resolve(dataUrl); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxPx / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || 1) * scale));
          const h = Math.max(1, Math.round((img.height || 1) * scale));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", quality));
        } catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch { resolve(dataUrl); }
  });
}

/**
 * Persist a prescription as a health record (PHI) server-side. Returns its id; the
 * raw Rx values never touch the cart, order metadata, or localStorage.
 *
 * `ctx.tryon_image` (la imagen del probador) es OPCIONAL y de mejor esfuerzo: si
 * el backend aún no acepta el campo (o el cuerpo es muy grande), reintentamos sin
 * la imagen para que la compra NUNCA se rompa por esto — la imagen se guardará en
 * cuanto el backend esté desplegado.
 */
export async function createPrescription(prescription, ctx = {}) {
  const base = { prescription, usage_type: ctx.usage_type, eye_size: ctx.eye_size };
  let tryonImage = null;
  if (ctx.tryon_image) {
    try { tryonImage = await downscaleDataUrl(ctx.tryon_image); }
    catch { tryonImage = ctx.tryon_image; }
  }
  const post = (body) => medusa.client.fetch("/store/prescriptions", { method: "POST", body });
  try {
    const res = await post(tryonImage ? { ...base, tryon_image: tryonImage } : base);
    return res.prescription_id || null;
  } catch (e) {
    // Si el fallo fue por incluir la imagen (backend viejo / cuerpo grande),
    // reintenta sin ella: la receta y la compra deben completarse igual.
    if (!tryonImage) throw e;
    const res = await post(base);
    return res.prescription_id || null;
  }
}

/**
 * Failure reasons the OCR endpoint can report, normalised for the UI.
 *
 * The caller needs to tell these apart: "your photo is too big" and "the
 * service is down" call for completely different advice, and collapsing both
 * into "we couldn't read it" is what left customers re-uploading the same
 * photo while the prescription fields sat at 0.00.
 *
 * `code` is whatever the backend sent in `error_code`, falling back to a
 * status-derived guess so an older backend (one deployed before error codes
 * existed) still produces something better than nothing.
 */
export class OcrError extends Error {
  constructor(code, status, retryAfterSeconds) {
    super(code);
    this.name = "OcrError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds ?? null;
  }
}

/** Best guess at a reason when the backend predates `error_code`. */
function codeFromStatus(status) {
  if (status === 413) return "file_too_large";
  if (status === 415) return "unsupported_media_type";
  if (status === 429) return "ocr_rate_limited";
  if (status === 422) return "ocr_unreadable";
  if (status === 503) return "ocr_unavailable";
  return "ocr_failed";
}

/**
 * Read a prescription photo via the backend OCR endpoint. The file is uploaded
 * as multipart and never touches R2 from the browser — the backend owns the
 * private PHI bucket. Returns { prescription, validation, message }; the
 * prescription always comes back with verified_by_user=false, so the caller
 * must have the user confirm the values before persisting them.
 *
 * The file is re-encoded first (see lib/imagePrep.js): a phone photo arrives as
 * HEIC and/or well over the 10 MB cap, and both were rejected before the read
 * ever started.
 */
export async function ocrPrescription(file) {
  const prepared = await preparePrescriptionFile(file);
  const form = new FormData();
  form.append("file", prepared);
  try {
    return await medusa.client.fetch("/store/prescriptions/ocr", {
      method: "POST",
      body: form,
      // The SDK defaults to application/json and would JSON.stringify the
      // FormData; dropping the header lets the browser set the multipart
      // boundary itself.
      headers: { "content-type": null },
    });
  } catch (err) {
    // The SDK throws a plain Error carrying the status; the parsed body hangs
    // off it on the versions that expose one. Read both defensively so a shape
    // change downgrades the message instead of throwing over the throw.
    const status = err?.status ?? err?.response?.status ?? 0;
    const body = err?.body ?? err?.response?.data ?? null;
    throw new OcrError(
      body?.error_code || codeFromStatus(status),
      status,
      body?.retry_after_seconds
    );
  }
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

/**
 * Re-price the cart against today's catalog. Returns the cart plus what moved.
 *
 * A configured line is priced once, when it is added, and Medusa never revisits a
 * custom price — so a cart left open carries stale frame prices, a stale lens
 * matrix and a stale tax rate. The backend re-quotes from the line's own metadata
 * (see /store/carts/:id/revalidate); the client sends no amounts and computes
 * none. Called automatically on cart load and on entering checkout, so the
 * shopper never has to ask for it.
 *
 * Shape: { cart, repriced: [{item_id, title, from, to}], stale: [...], locked }.
 * `repriced` is what the UI must surface — silently charging a different total
 * than the one the customer last saw is not an acceptable way to be transparent.
 * A failure here is non-fatal: the caller keeps the cart it already had.
 */
export async function revalidateCart() {
  const id = readId();
  if (!id) return null;
  let res;
  try {
    res = await medusa.client.fetch(`/store/carts/${id}/revalidate`, { method: "POST" });
  } catch {
    return null;
  }
  // Deliberately re-read through getCart() instead of using the cart the route
  // returns: that one carries a trimmed field set, and the checkout summary
  // needs CART_FIELDS (shipping_total, tax_total, shipping_address…). Reusing it
  // would blank out the shipping and tax lines right where the customer is
  // checking the total.
  const cart = await getCart();
  return {
    cart,
    repriced: (res && res.repriced) || [],
    stale: (res && res.stale) || [],
    locked: Boolean(res && res.locked),
  };
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

export async function updateContact({ email, shipping_address, metadata }) {
  const id = readId();
  if (!id) return null;
  // Re-send the locale on every contact update: this is the last write before
  // payment, so it captures a language the shopper switched to after the cart was
  // created — which is the language their confirmation email should arrive in.
  const body = { locale: activeLocale() };
  if (email) body.email = email;
  if (shipping_address) body.shipping_address = shipping_address;
  // Preferencias de notificación (email/SMS), celular e idioma para que el
  // backend pueda enviar la confirmación del pedido por el canal elegido.
  if (metadata && typeof metadata === "object") body.metadata = metadata;
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
 * Statuses that mean "not yet", not "never" — the request is worth repeating.
 *
 * 400 is the important one. Right after a successful charge, `/complete` answers
 *   400 {"type":"not_allowed","message":"Session: payses_… was not authorized
 *        with the provider."}
 * because `stripe.confirmPayment()` resolves as soon as the charge is accepted,
 * while the PaymentIntent can still read `processing` for a few seconds. Medusa's
 * Stripe provider maps `processing` to PENDING rather than AUTHORIZED, so
 * completion is refused until the intent settles into `succeeded` /
 * `requires_capture`. That is the single most likely outcome in the seconds after
 * payment and it clears on its own, so it MUST be retried.
 *
 * 409 gets the same treatment: a concurrent completion of the same cart (e.g. the
 * payment webhook and this tab racing) resolves once the other side finishes.
 */
const RETRYABLE_HTTP_STATUS = new Set([400, 409]);

/**
 * Whether a failure is worth giving up on immediately.
 *
 * A thrown 4xx usually means the request won't succeed on retry (cart not found,
 * gone, unauthorized) — retrying is pointless and would only loop. The exceptions
 * are listed in RETRYABLE_HTTP_STATUS above. 5xx, timeouts and network errors
 * carry no status (or >= 500) and are transient.
 *
 * NOTE: every completion error arrives here as a thrown FetchError, never as the
 * SDK's documented in-band `{ type: "cart", error }` value — `cart.complete()`
 * goes straight through `client.fetch`, which throws for any status >= 300. The
 * in-band branch in completeCartWithRetry is kept only as a belt-and-braces guard.
 */
function isTerminalError(e) {
  const status = e && (e.status || (e.response && e.response.status));
  if (typeof status !== "number") return false;        // network / timeout
  if (RETRYABLE_HTTP_STATUS.has(status)) return false; // "not yet" — keep trying
  return status >= 400 && status < 500;
}

/**
 * Complete the cart → order with retry + exponential backoff, idempotently.
 *
 * `cartId` defaults to the active cart id; recovery passes the id saved in the
 * pending marker (which survives writeId(null)). Returns one of:
 *   { ok: true,  order }                 — order created (or already existed)
 *   { ok: false, pending: true, error }  — payment confirmed but the order could
 *                                          not be confirmed after retries; the
 *                                          marker is KEPT so a later load — or
 *                                          Medusa's own webhook-driven
 *                                          `processPaymentWorkflow`, which
 *                                          completes the cart server-side once
 *                                          the gateway reports the capture — can
 *                                          still finish it
 *   { ok: false, terminal: true, error } — a non-retryable 4xx (e.g. the cart no
 *                                          longer exists). The caller decides
 *                                          whether to clear the marker; this fn
 *                                          does NOT, so a genuinely captured
 *                                          payment is never silently forgotten.
 *   { ok: false, error: "no_cart" }      — nothing to complete
 *
 * "Payment session not authorized yet" (HTTP 400) is the expected first answer in
 * the seconds after Stripe confirms, so it is retried rather than reported — see
 * RETRYABLE_HTTP_STATUS. Thrown 5xx/network errors are transient too. Only after
 * exhausting the retry window do we report `pending`.
 */
export async function completeCartWithRetry(
  cartId = readId(),
  { retries = 6, baseDelay = 500, maxDelay = 3000, budgetMs = 20000 } = {}
) {
  if (!cartId) return { ok: false, error: "no_cart" };
  const startedAt = Date.now();
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await medusa.store.cart.complete(cartId);
      if (res.type === "order") {
        writeId(null);          // the cart became an order — drop the cart id
        clearPendingOrder();    // …and the recovery marker
        return { ok: true, order: res.order };
      }
      // Belt-and-braces: the SDK throws rather than returning this shape (see
      // isTerminalError), but if that ever changes, treat it as retryable.
      lastErr = res.error || res;
    } catch (e) {
      if (isTerminalError(e)) {
        // A 4xx we can't recover from (cart not found / gone / unauthorized).
        // Stop now and let the caller decide about the marker (recovery clears
        // it to break the loop; pay() keeps it — the payment was just captured).
        return { ok: false, terminal: true, error: (e && e.message) || String(e) };
      }
      // Thrown 5xx / timeout / network → transient by assumption.
      lastErr = (e && e.message) || String(e);
    }
    if (attempt >= retries) break;

    // Backoff between attempts, capped (0.5s, 1s, 2s, 3s, 3s, 3s) so the tail
    // stays responsive: we are waiting on Stripe to settle an intent, which takes
    // a few seconds at most, and more attempts inside the same window catch the
    // moment it flips sooner than fewer, ever-longer sleeps would.
    const wait = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    // The sleeps are not what bounds this loop — a *rejected* /complete costs
    // ~5s server-side on its own (measured against the deployed backend), so the
    // attempt count alone would leave a customer watching a spinner for ~48s
    // before the pending screen appears. Stop starting attempts once the budget
    // is spent; the pending screen and the payment webhook both still recover it.
    if (Date.now() - startedAt + wait >= budgetMs) break;

    await sleep(wait);
  }
  // Money is committed but no order surfaced. Preserve the marker for recovery.
  return { ok: false, pending: true, error: lastErr };
}

export function clearCartId() { writeId(null); }
