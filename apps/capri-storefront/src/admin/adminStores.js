// Tiendas físicas (API real /admin/establishments). Módulo sin hook de idioma:
// los errores viajan como CLAVES adm.err.stores.* y traduce quien pinta.
import { adminFetch } from "./adminApi.js";

const reasonKey = (e, fallback) => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  return r ? `adm.err.stores.${r}` : fallback;
};

export async function fetchStores() {
  return adminFetch("/admin/establishments");
}

export async function createStore({ name, address = "", phone = "" }) {
  try {
    return await adminFetch("/admin/establishments", { method: "POST", body: { name, address, phone } });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.stores.saveFailed"));
  }
}

/* ── Precios por tienda (/admin/store-pricing/:id) ── */

const pricingKey = (e, fallback) => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  return r ? `adm.err.pricing.${r}` : fallback;
};

export async function fetchStorePricing(id) {
  return adminFetch(`/admin/store-pricing/${encodeURIComponent(id)}`);
}

/** mode: "none" | "percent" | "delta" (monto fijo por venta). */
export async function setStoreAdjustment(id, mode, value) {
  try {
    return await adminFetch(`/admin/store-pricing/${encodeURIComponent(id)}/adjustment`, { method: "POST", body: { mode, value } });
  } catch (e) {
    throw new Error(pricingKey(e, "adm.err.pricing.saveFailed"));
  }
}

/** Precio exacto de un modelo en la tienda; price null lo quita. */
export async function setStoreExactPrice(id, { scope = "frame", productId, price }) {
  try {
    return await adminFetch(`/admin/store-pricing/${encodeURIComponent(id)}/exact`, { method: "POST", body: { scope, target: productId, price } });
  } catch (e) {
    throw new Error(pricingKey(e, "adm.err.pricing.saveFailed"));
  }
}

/**
 * Precio mínimo (HU-16): scope "all" = suelo en % del precio de lista de cada
 * renglón; "frame"/"case" + producto = importe mínimo de esa montura. null lo quita.
 */
export async function setStoreMinimum(id, { scope, productId = null, value }) {
  try {
    return await adminFetch(`/admin/store-pricing/${encodeURIComponent(id)}/minimum`, { method: "POST", body: { scope, target: productId, value } });
  } catch (e) {
    throw new Error(pricingKey(e, "adm.err.pricing.saveFailed"));
  }
}

/** Plan (apply=false) o aplicación (apply=true) de la lista de precios del dueño. */
export async function importOwnerPrices(prices, apply = false) {
  try {
    return await adminFetch("/admin/store-pricing/import", { method: "POST", body: { prices, apply } });
  } catch (e) {
    throw new Error(pricingKey(e, "adm.err.pricing.importFailed"));
  }
}

export async function previewStorePrices(id, productIds, lenses = 0) {
  return adminFetch(`/admin/store-pricing/${encodeURIComponent(id)}/preview`, {
    query: { products: productIds.join(","), lenses },
  });
}

export async function updateStore(id, patch) {
  try {
    return await adminFetch(`/admin/establishments/${encodeURIComponent(id)}`, { method: "POST", body: patch });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.stores.saveFailed"));
  }
}

/* ── Surtido por tienda (/admin/store-assortment/:id) ── */

const assortmentKey = (e, fallback) => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  return r ? `adm.err.assortment.${r}` : fallback;
};

export async function fetchStoreAssortment(id) {
  return adminFetch(`/admin/store-assortment/${encodeURIComponent(id)}`);
}

/**
 * Modelos del catálogo del servidor (no el que cargó el navegador) con su
 * exposición en la tienda: { id, title, brand, is_case, exposed }.
 */
export async function searchStoreCatalog(id, { q = "", brand = "", limit } = {}) {
  const query = { q };
  if (brand) query.brand = brand;
  if (limit) query.limit = limit;
  return adminFetch(`/admin/store-assortment/${encodeURIComponent(id)}/products`, { query });
}

/** Ficha de un modelo en la tienda (fotos, medidas, precios, exposición). */
export async function fetchStoreModel(id, productId) {
  return adminFetch(`/admin/store-assortment/${encodeURIComponent(id)}/products/${encodeURIComponent(productId)}`);
}

/** scope "brand" (slug) | "product" (id); exposed true/false, o null para volver a lo heredado. */
export async function setAssortmentRule(id, { scope, target, exposed }) {
  try {
    return await adminFetch(`/admin/store-assortment/${encodeURIComponent(id)}/rule`, { method: "POST", body: { scope, target, exposed } });
  } catch (e) {
    throw new Error(assortmentKey(e, "adm.err.assortment.saveFailed"));
  }
}
