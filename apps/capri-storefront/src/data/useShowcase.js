// La vitrina que eligió el dueño (data/showcase.js), leída UNA vez por visita
// de GET /store/web-showcase y aplicada con `useShowcaseOrder(products)`.
//
//   - La última vitrina vista se recuerda en localStorage: una visita repetida
//     abre ya en su orden, sin saltar de Di Caprio a la mezcla al llegar la red.
//   - La semilla de la mezcla al azar dura lo que la pestaña (sessionStorage):
//     volver a la portada no reordena lo que el cliente acaba de ver; una
//     visita nueva trae otra mezcla.
//   - Sin clave publicable (catálogo estático) o sin red: el orden del catálogo.
import { useEffect, useMemo, useState } from "react";
import { MEDUSA_PUBLISHABLE_KEY, MEDUSA_URL } from "./medusa.js";
import { DEFAULT_SHOWCASE, normalizeShowcase, showcaseOrder } from "./showcase.js";

const CACHE_KEY = "web_showcase_v1";
const SEED_KEY = "web_showcase_seed_v1";

function cached() {
  try {
    return normalizeShowcase(JSON.parse(localStorage.getItem(CACHE_KEY) || "null"));
  } catch {
    return DEFAULT_SHOWCASE;
  }
}

function visitSeed() {
  try {
    const have = Number(sessionStorage.getItem(SEED_KEY));
    if (Number.isFinite(have) && have > 0) return have;
    const seed = Math.floor(Math.random() * 2 ** 31) + 1;
    sessionStorage.setItem(SEED_KEY, String(seed));
    return seed;
  } catch {
    return Math.floor(Math.random() * 2 ** 31) + 1;
  }
}

let current = typeof window === "undefined" ? DEFAULT_SHOWCASE : cached();
let inflight = null;
const listeners = new Set();

function load() {
  if (inflight || !MEDUSA_PUBLISHABLE_KEY || typeof fetch === "undefined") return inflight;
  inflight = fetch(`${MEDUSA_URL}/store/web-showcase`, { headers: { "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY } })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (!body) return;
      const next = normalizeShowcase(body.showcase);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        current = next;
        listeners.forEach((fn) => fn(next));
      }
    })
    .catch(() => { /* sin red o backend anterior: se queda la última conocida */ });
  return inflight;
}

/** La vitrina vigente (se actualiza sola cuando llega la del servidor). */
export function useShowcase() {
  const [showcase, setShowcase] = useState(current);
  useEffect(() => {
    listeners.add(setShowcase);
    load();
    return () => { listeners.delete(setShowcase); };
  }, []);
  return showcase;
}

/** `products` en el orden de la vitrina, con la semilla de esta visita. */
export function useShowcaseOrder(products) {
  const showcase = useShowcase();
  const [seed] = useState(visitSeed);
  return useMemo(() => showcaseOrder(products, showcase, seed), [products, showcase, seed]);
}
