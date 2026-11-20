// «Vitrina de la tienda web» (dueño, 20-nov-2026): qué marcas enseña primero la
// web como ejemplos — la fila «Los más vendidos» de la portada y el orden por
// defecto («Relevancia») del catálogo. Lo decide el dueño en el panel
// (Tiendas → Tienda online → Vitrina; backend lib/web-showcase.ts) y llega por
// GET /store/web-showcase.
//
//   catalog → el orden del catálogo, como antes (nada se mueve);
//   brands  → primero las marcas elegidas, en el orden del dueño y por turnos
//             (una de cada, luego la siguiente de cada…), después el resto;
//   random  → mezcla al azar por turnos entre marcas (las elegidas o, sin
//             ninguna, todas), distinta en cada visita; después el resto.
//
// Solo cambia el ORDEN: no se oculta ninguna montura ni se toca un precio.
// Puro (probado por scripts/test-showcase.mjs); el hook está en useShowcase.js.

export const SHOWCASE_MODES = ["catalog", "brands", "random"];
export const DEFAULT_SHOWCASE = Object.freeze({ mode: "catalog", brands: [] });

/** Lo que venga del servidor (o nada) como vitrina válida. */
export function normalizeShowcase(raw) {
  const mode = SHOWCASE_MODES.includes(raw?.mode) ? raw.mode : "catalog";
  const brands = Array.isArray(raw?.brands) ? raw.brands.filter((b) => typeof b === "string" && b) : [];
  if (mode === "brands" && !brands.length) return DEFAULT_SHOWCASE;
  return { mode, brands: mode === "catalog" ? [] : [...new Set(brands)] };
}

/** Generador pseudoaleatorio con semilla (mulberry32): la misma semilla, la misma mezcla. */
export function seededRandom(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Por turnos: el 1.º de cada grupo, luego el 2.º de cada uno… */
function roundRobin(groups) {
  const out = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max; i += 1) for (const g of groups) if (i < g.length) out.push(g[i]);
  return out;
}

/**
 * `products` en el orden de la vitrina. `seed` solo cuenta en `random` (una
 * por visita: misma visita, mismo orden al volver a la portada). Devuelve una
 * lista nueva con los mismos productos; nunca quita ni añade ninguno.
 */
export function showcaseOrder(products, showcase, seed = 1) {
  const list = Array.isArray(products) ? products : [];
  const { mode, brands } = normalizeShowcase(showcase);
  if (mode === "catalog" || list.length < 2) return list;

  const bySlug = new Map();
  for (const p of list) {
    const slug = p?.brand_slug || "";
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(p);
  }

  if (mode === "brands") {
    const chosen = brands.filter((s) => bySlug.has(s));
    if (!chosen.length) return list;
    const picked = new Set(chosen);
    const front = roundRobin(chosen.map((s) => bySlug.get(s)));
    return [...front, ...list.filter((p) => !picked.has(p?.brand_slug || ""))];
  }

  // random: las marcas elegidas (o todas) en orden al azar, cada una con sus
  // modelos mezclados, por turnos; el resto, en el orden del catálogo.
  const rnd = seededRandom(seed);
  const pool = brands.length ? brands.filter((s) => bySlug.has(s)) : [...bySlug.keys()].filter(Boolean);
  if (!pool.length) return list;
  const picked = new Set(pool);
  const front = roundRobin(shuffle(pool, rnd).map((s) => shuffle(bySlug.get(s), rnd)));
  return [...front, ...list.filter((p) => !picked.has(p?.brand_slug || ""))];
}
