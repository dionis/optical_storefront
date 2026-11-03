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

   Y tiene DOS capas, las mismas que los precios: el maestro (todas las tiendas)
   y la variación de cada tienda. `store` elige cuál se lee y cuál se escribe,
   igual que en el resto del panel de precios: "all" (o vacío) = el maestro.
     GET  /admin/pricing/frames/costs?store=<id>
            → { store, costs:[{ sku, model, book_cents, cost_cents, origin,
                 source, master_cost_cents, inherited, updated_at }],
                 summary:{ with_cost, without_cost, store_variations } }
     POST /admin/pricing/frames/cost  { sku, cost_cents }                → maestro
     POST /admin/pricing/frames/cost  { sku, cost_cents: null }          → maestro a la lista
     POST /admin/pricing/frames/cost  { sku, cost_cents, store }         → esa tienda
     POST /admin/pricing/frames/cost  { sku, cost_cents: null, store }   → la tienda vuelve a heredar
   `cost_cents` es SIEMPRE el costo efectivo del alcance pedido, y puede venir
   null: ese modelo NO tiene costo conocido, y eso se enseña como lo que es (un
   agujero en la contabilidad), nunca como 0. `master_cost_cents` viene al lado
   para poder enseñar las dos cifras sin pedir la pantalla dos veces.           */

const COSTS_PATH = "/admin/pricing/frames/costs";
/** TTL largo: un costo cambia cuando el proveedor manda lista nueva, no al minuto. */
const COSTS_TTL = 15 * 60_000;

/** Un SKU comparable: «ML 8» y «ml-8» son el mismo modelo. */
export const skuKey = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");

/**
 * ¿Esta cifra la puso una persona o viene de la lista del proveedor? El backend
 * manda `origin`: `"store_variation"` (el costo propio de la tienda abierta),
 * `"owner_edit"` (el dueño lo tecleó en el maestro) o `"supplier_list"` (es del
 * proveedor) — ver api/admin/pricing/frames/costs. Los dos primeros son
 * «propio». Se aceptan además las palabras que se barajaron mientras se
 * escribía la ruta, y `source` como respaldo, para que un despliegue a medias
 * no pinte como «de la lista» un costo que alguien tecleó — que es el error
 * caro.
 */
export const isOwnCost = (source) =>
  ["store_variation", "owner_edit", "owner", "manual", "override"].includes(String(source || ""));

function indexCosts(payload, store) {
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
    // De qué alcance son estas cifras: el id de la tienda abierta, o null = el
    // maestro. Quien pinta lo necesita para decir «Heredado» solo cuando hay
    // una tienda elegida, y para guardar en el mismo sitio del que leyó.
    store: payload?.store ?? (store && store !== "all" && store !== "web" ? store : null),
    // El resumen del servidor manda (cuenta el catálogo entero, no solo las
    // filas que vinieron); si no lo manda, se cuenta lo que hay.
    summary: {
      with_cost: payload?.summary?.with_cost ?? counted.with_cost,
      without_cost: payload?.summary?.without_cost ?? counted.without_cost,
      store_variations: payload?.summary?.store_variations ?? 0,
    },
    offline: false,
  };
}

/** Índice de respaldo cuando el servidor no contesta: solo lectura. */
const offlineIndex = () => ({ rows: [], bySku: null, byModel: null, store: null, summary: null, offline: true });

/**
 * Los costos de todas las monturas PARA UN ALCANCE: `store` "all" (o vacío) es
 * el maestro y un id de tienda es lo que paga esa tienda, con el maestro al
 * lado en cada fila. Va por la caché de lecturas del panel, con una entrada por
 * tienda (`queryKey` incluye la consulta), así que dos pantallas que pidan la
 * misma tienda hacen UNA petición y comparten la entrada, y cambiar de tienda
 * no pisa lo ya leído de la otra.
 *
 * Nunca rechaza: si el servidor falla cae al respaldo del navegador marcado
 * con `offline`, y quien pinta avisa de que no se puede editar.
 */
export async function loadFrameCosts({ force = false, store = "all" } = {}) {
  try {
    return indexCosts(await adminGet(COSTS_PATH, { query: { store }, ttl: COSTS_TTL, force }), store);
  } catch {
    return offlineIndex();
  }
}

/**
 * El costo de un modelo EN EL ALCANCE que se leyó (el maestro, o la tienda
 * abierta). Devuelve siempre un descriptor, y `cents: null` cuando el costo NO
 * se conoce — que es el caso que hay que ver, no esconder.
 *
 * Con una tienda abierta el descriptor trae además:
 *   `inherited`    la tienda no tiene costo propio: esta cifra es la del maestro
 *   `masterCents`  lo que paga la cadena, para enseñar las dos cifras juntas
 *   `storeOwn`     la cifra es la variación de ESTA tienda
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
      origin: "fallback",
      bookCents: null,
      masterCents: null,
      updatedAt: null,
      own: false,
      storeOwn: false,
      inherited: false,
      store: null,
      editable: false,
      row: null,
    };
  }
  const row = index.bySku.get(skuKey(sku)) || index.byModel.get(skuKey(name)) || null;
  // `origin` es lo que manda; `source` queda de respaldo para un servidor que
  // todavía no lo mande (describe el maestro, que es lo que había antes).
  const origin = row?.origin || row?.source || null;
  const positive = (v) => (Number(v) > 0 ? Number(v) : null);
  return {
    // Cero NO es un costo: el servidor también lo marca como desconocido
    // (`undefined_cost`). El proveedor no regala monturas, y pintar «0 %»
    // de margen sobre un cero es justo la mentira que esto viene a quitar.
    cents: row ? positive(row.cost_cents) : null,
    source: row?.source || null,
    origin,
    bookCents: row?.book_cents ?? null,
    // Sin `master_cost_cents` (servidor viejo) el maestro ES lo que vino.
    masterCents: row ? positive(row.master_cost_cents ?? row.cost_cents) : null,
    updatedAt: row?.updated_at || null,
    own: isOwnCost(origin),
    storeOwn: origin === "store_variation",
    // Solo se hereda cuando hay una tienda abierta y no tiene cifra propia.
    inherited: Boolean(index.store) && row ? row.inherited !== false : false,
    store: index.store || null,
    editable: true,
    row,
  };
}

/* ──────────── Suelo y techo del precio (la «banda») ────────────
   Lo que pidió el dueño: si el precio DESPUÉS DE CONVERSIÓN queda por debajo
   de un umbral, se lleva a una cifra fija; si queda por encima de otro, se baja
   a un tope. Dos números por lado, porque «menos de 30 vale 60» no se puede
   decir con uno solo.

   Tiene las MISMAS dos capas que el costo y el precio: con «Todas las tiendas»
   se lee y se escribe el MAESTRO (lo que el dueño pone una vez para toda la
   cadena) y con una tienda elegida, SU variación, con «Heredado» cuando no
   maneja banda propia.
     GET  /admin/pricing/frames/band?store=<id>
     POST /admin/pricing/frames/band  { …cents…, store?, clear?, dry_run? }
   La respuesta trae siempre `impact`: cuántos modelos sube el suelo, cuántos
   baja el techo y ejemplos concretos. Con `dry_run: true` NO guarda nada: es
   la vista previa que se enseña ANTES de guardar.

   En esta capa los números viajan en CENTAVOS (como los costos) y la pantalla
   trabaja en dólares; `usdToCents`/`centsToUsd` son la frontera.               */

const BAND_PATH = "/admin/pricing/frames/band";

/** Dólares de un campo de texto a centavos enteros; vacío = ese lado no se usa. */
export const usdToCents = (v) =>
  v === null || v === undefined || String(v).trim() === "" ? null : Math.round(Number(v) * 100);

/** Centavos a dólares para pintar en un campo; null se queda vacío. */
export const centsToUsd = (c) => (c === null || c === undefined ? "" : String(Number(c) / 100));

/** El cuerpo que esperan las rutas, desde el borrador de la pantalla. */
const bandBody = (band, store) => ({
  store,
  floor_below_cents: usdToCents(band?.floorBelow),
  floor_to_cents: usdToCents(band?.floorTo),
  cap_above_cents: usdToCents(band?.capAbove),
  cap_to_cents: usdToCents(band?.capTo),
  apply_to_cases: Boolean(band?.applyToCases),
  enabled: band?.enabled !== false,
});

/**
 * La banda del alcance pedido, con la del maestro al lado y el impacto de la
 * que está guardada. Nunca rechaza: sin servidor devuelve `offline` y la
 * pantalla avisa de que no se puede editar (igual que los costos).
 */
export async function loadPriceBand({ store = "all", force = false } = {}) {
  try {
    const data = await adminGet(BAND_PATH, { query: { store }, ttl: COSTS_TTL, force });
    return { ...data, offline: false };
  } catch {
    return { store: null, band: null, master: null, origin: "none", inherited: false, impact: null, offline: true };
  }
}

/**
 * Qué le pasaría a los precios con ESTA banda, sin guardar nada. Es lo que se
 * enseña mientras el dueño teclea: ya vivió que un cambio de regla le moviera
 * 147 precios, y no puede volver a pasar a ciegas.
 */
export function previewPriceBand({ band, store = "all" }) {
  return post(BAND_PATH, { ...bandBody(band, store), dry_run: true });
}

/**
 * Guarda la banda del alcance: con «Todas las tiendas» la de la cadena, con una
 * tienda su variación. `clear: true` la quita — el maestro deja de ajustar
 * nada y una tienda vuelve a heredar el maestro.
 *
 * Después olvida las entradas cacheadas de la banda Y de los costos: la banda
 * mueve precios, y el margen que se pinta al lado del costo sale de ellos.
 */
export async function savePriceBand({ band, store = "all", clear = false }) {
  const data = await post(BAND_PATH, clear ? { store, clear: true } : bandBody(band, store));
  invalidateCache(BAND_PATH);
  invalidateCache(COSTS_PATH);
  return data;
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
 * Fija el costo de un modelo en un alcance: con `store` "all" (o sin él) mueve
 * el MAESTRO, y con el id de una tienda fija lo que paga esa tienda. `costUsd`
 * null lo devuelve a la capa de arriba — el maestro, a la lista del proveedor;
 * una tienda, a heredar el maestro.
 *
 * Después olvida TODAS las entradas cacheadas de los costos (la llamada es por
 * prefijo, así que cae también la de las demás tiendas): mover el maestro
 * cambia lo que heredan todas, y una pantalla que lo vuelva a pedir tiene que
 * ver el nuevo.
 */
export async function saveFrameCost({ sku, costUsd, store = "all" }) {
  const empty = costUsd === null || costUsd === undefined || costUsd === "";
  const data = await post("/admin/pricing/frames/cost", {
    sku,
    cost_cents: empty ? null : Math.round(Number(costUsd) * 100),
    store,
  });
  invalidateCache(COSTS_PATH);
  return data;
}
