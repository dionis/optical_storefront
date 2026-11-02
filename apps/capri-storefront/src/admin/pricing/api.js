// Llamadas de «Precios y costos» (/admin/pricing/*). Módulo SIN hook de
// idioma: lo que llegue a la pantalla viaja como CLAVE de diccionario
// (adm.err.pricing.<reason>) y traduce quien pinta.
import { adminFetch } from "../adminApi.js";

const key = (e, fallback) => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  return r ? `adm.err.pricing.${r}` : fallback;
};

const post = async (path, body) => {
  try {
    return await adminFetch(path, { method: "POST", body });
  } catch (e) {
    throw new Error(key(e, "adm.err.pricing.save_failed"));
  }
};

/** El panel entero en una sola lectura. `store` "all" = el maestro. */
export async function fetchPricingOverview(store = "all") {
  try {
    return await adminFetch("/admin/pricing/overview", { query: { store } });
  } catch (e) {
    throw new Error(key(e, "adm.err.pricing.load_failed"));
  }
}

/** La regla de TODAS las monturas (o estuches). mode "none" la quita. */
export function savePricingRule({ scope = "frame", mode, value, store }) {
  return post("/admin/pricing/frames/rule", { scope, mode, value: mode === "none" ? null : Number(value), store });
}

/** Precio propio de un modelo; price null lo devuelve a la regla. */
export function savePricingOverride({ productId, variantId, price, kind = "frame", store }) {
  return post("/admin/pricing/frames/override", {
    product_id: productId,
    variant_id: variantId,
    price: price === null || price === "" ? null : Number(price),
    kind,
    store,
  });
}

/** Una casilla de lentes: kind "base"|"photo"|"ar"|"adjust". value null la devuelve al maestro. */
export function savePricingLens({ kind, key: itemKey, value, store }) {
  return post("/admin/pricing/lenses", { kind, key: itemKey, value: value === null || value === "" ? null : Number(value), store });
}

/** Comisión por defecto y/o la de cada vendedor. */
export function savePricingCommissions({ defaultPct, sellers }) {
  const body = {};
  if (defaultPct !== undefined) body.default_pct = defaultPct === null || defaultPct === "" ? null : Number(defaultPct);
  if (Array.isArray(sellers)) body.sellers = sellers.map((s) => ({ id: s.id, pct: Number(s.pct) }));
  return post("/admin/pricing/commissions", body);
}

/** Enciende o apaga un costo en UNA tienda. kind "rule" (regla) | "cost" (costo de la tienda). */
export function savePricingCostToggle({ kind = "rule", refId, store, enabled }) {
  return post("/admin/pricing/costs/toggle", { kind, ref_id: refId, store, enabled });
}

/** Impuesto de las monturas sin receta, en por ciento. */
export function savePricingTax(ratePct) {
  return post("/admin/pricing/taxes", { rate_pct: Number(ratePct) });
}
