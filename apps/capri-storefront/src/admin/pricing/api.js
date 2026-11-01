// Llamadas de «Precios y costos» (/admin/pricing/*). Módulo SIN hook de
// idioma: lo que llegue a la pantalla viaja como CLAVE de diccionario
// (adm.err.pricing.<reason>) y traduce quien pinta.
import { adminFetch, adminGet, invalidateCache } from "../adminApi.js";
// RESPALDO, no fuente: la lista de Capri que vivía en el navegador. Solo se usa
// si el servidor no contesta los costos (ver `loadFrameCosts`), para que la
// pantalla no quede en blanco; en ese estado NO se puede editar, porque lo que
// se guarda vive en el servidor y escribir sobre un dato viejo mentiría.
import { capriPrice } from "../../data/capriPrices.js";

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

/* ───────────────── Costo de proveedor de las monturas ─────────────────
   El costo ES del servidor: es lo que hace fiable la contabilidad, así que no
   puede depender de una tabla que cada navegador tenga más o menos al día.
     GET  /admin/pricing/frames/costs  → { rows:[{ sku, model, book_cents,
            cost_cents, source, updated_at }], summary:{ with_cost, without_cost } }
     POST /admin/pricing/frames/cost   { sku, cost_cents }       → lo fija
     POST /admin/pricing/frames/cost   { sku, cost_cents: null }  → vuelve a la lista
   `cost_cents` puede venir null: ese modelo NO tiene costo conocido, y eso se
   enseña como lo que es (un agujero en la contabilidad), nunca como 0.         */

const COSTS_PATH = "/admin/pricing/frames/costs";
/** TTL largo: un costo cambia cuando el proveedor manda lista nueva, no al minuto. */
const COSTS_TTL = 15 * 60_000;

/** Un SKU comparable: «ML 8» y «ml-8» son el mismo modelo. */
export const skuKey = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");

/**
 * `source` del servidor: ¿lo puso el dueño a mano o viene de la lista del
 * proveedor? El backend manda exactamente `"owner_edit"` o `"supplier_list"`
 * (ver api/admin/pricing/frames/costs). Se aceptan además las palabras que se
 * barajaron mientras se escribía la ruta, para que un despliegue a medias no
 * pinte como «de la lista» un costo que el dueño tecleó — que es el error caro.
 */
export const isOwnCost = (source) => ["owner_edit", "owner", "manual", "override"].includes(String(source || ""));

function indexCosts(payload) {
  // La ruta devuelve `costs`; `rows` se acepta por si alguna versión del
  // servidor lo nombra así. Sin esto la pantalla sale vacía sin decir por qué.
  const rows = Array.isArray(payload?.costs) ? payload.costs : Array.isArray(payload?.rows) ? payload.rows : [];
  const bySku = new Map();
  const byModel = new Map();
  for (const r of rows) {
    const k = skuKey(r.sku);
    if (k) bySku.set(k, r);
    const m = skuKey(r.model);
    // El modelo solo se indexa si no choca con un SKU: el SKU manda.
    if (m && !byModel.has(m)) byModel.set(m, r);
  }
  const counted = {
    with_cost: rows.filter((r) => Number(r.cost_cents) > 0).length,
    without_cost: rows.filter((r) => !(Number(r.cost_cents) > 0)).length,
  };
  return {
    rows,
    bySku,
    byModel,
    // El resumen del servidor manda (cuenta el catálogo entero, no solo las
    // filas que vinieron); si no lo manda, se cuenta lo que hay.
    summary: {
      with_cost: payload?.summary?.with_cost ?? counted.with_cost,
      without_cost: payload?.summary?.without_cost ?? counted.without_cost,
    },
    offline: false,
  };
}

/** Índice de respaldo cuando el servidor no contesta: solo lectura. */
const offlineIndex = () => ({ rows: [], bySku: null, byModel: null, summary: null, offline: true });

/**
 * Los costos de todas las monturas, por la caché de lecturas del panel: dos
 * pantallas que los pidan a la vez hacen UNA petición y comparten la entrada.
 * Nunca rechaza: si el servidor falla cae al respaldo del navegador marcado
 * con `offline`, y quien pinta avisa de que no se puede editar.
 */
export async function loadFrameCosts({ force = false } = {}) {
  try {
    return indexCosts(await adminGet(COSTS_PATH, { ttl: COSTS_TTL, force }));
  } catch {
    return offlineIndex();
  }
}

/**
 * El costo de un modelo. Devuelve siempre un descriptor, y `cents: null`
 * cuando el costo NO se conoce — que es el caso que hay que ver, no esconder.
 */
export function costOf(index, product) {
  if (!index || !product) return null;
  const sku = product.sku || null;
  const name = product.model || product.name || null;
  if (index.offline) {
    const usd = capriPrice(sku || name || "");
    return {
      cents: usd == null ? null : Math.round(usd * 100),
      source: "fallback",
      bookCents: null,
      updatedAt: null,
      own: false,
      editable: false,
      row: null,
    };
  }
  const row = index.bySku.get(skuKey(sku)) || index.byModel.get(skuKey(name)) || null;
  return {
    // Cero NO es un costo: el servidor también lo marca como desconocido
    // (`undefined_cost`). El proveedor no regala monturas, y pintar «0 %»
    // de margen sobre un cero es justo la mentira que esto viene a quitar.
    cents: row && Number(row.cost_cents) > 0 ? Number(row.cost_cents) : null,
    source: row?.source || null,
    bookCents: row?.book_cents ?? null,
    updatedAt: row?.updated_at || null,
    own: isOwnCost(row?.source),
    editable: true,
    row,
  };
}

/** Margen sobre el precio de venta, en por ciento entero. null si no se puede saber. */
export function marginPct(price, cost) {
  const p = Number(price);
  const c = Number(cost);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (!Number.isFinite(c) || c < 0) return null;
  return Math.round(((p - c) / p) * 100);
}

/**
 * Fija el costo de un modelo; `costUsd` null lo devuelve al de la lista del
 * proveedor. Después olvida la entrada cacheada: el costo acaba de cambiar y
 * cualquier pantalla que lo vuelva a pedir tiene que ver el nuevo.
 */
export async function saveFrameCost({ sku, costUsd }) {
  const empty = costUsd === null || costUsd === undefined || costUsd === "";
  const data = await post("/admin/pricing/frames/cost", {
    sku,
    cost_cents: empty ? null : Math.round(Number(costUsd) * 100),
  });
  invalidateCache(COSTS_PATH);
  return data;
}
