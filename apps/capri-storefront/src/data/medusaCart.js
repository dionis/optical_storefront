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

export function clearCartId() { writeId(null); }
