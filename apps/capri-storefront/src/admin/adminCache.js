// Dónde se usa: adminApi.js (`adminGet`), posApi.js (lecturas del POS),
// useStoreTheme.js (tiendas y contexto), AdminShell.jsx (`prefetchTab`) y toda
// pantalla que lea con `useCached`. Caché de LECTURAS del panel para que
// cambiar de pestaña no vuelva a esperar al servidor: lo que ya se leyó se
// pinta al instante y se refresca por detrás.
//
// Qué hace, en cuatro reglas:
//  · Una URL = una entrada { data, at }. En memoria (Map) y en sessionStorage
//    (`adm.cache:<url>`), así sobrevive a recargar la pestaña del navegador
//    pero muere con la sesión, como el token (adminApi.js).
//  · Dos lecturas de la misma URL a la vez = UNA petición (`inflight`).
//  · Stale-while-revalidate: con dato guardado se devuelve YA; si es más viejo
//    que `ttl`, se vuelve a pedir por detrás y se avisa a quien esté suscrito
//    (`useCached` se vuelve a pintar con el dato nuevo).
//  · `invalidate(prefix)` tras una mutación (cobro, etapa, cierre de caja,
//    aprobación): borra las entradas que empiezan por ese prefijo y vuelve a
//    pedir las que alguien tenga en pantalla.
//
//   const data = await cachedGet("/admin/pos/context", { ttl: 300_000 });
//   const { data, loading, error, refresh } = useCached("/admin/pos/sales?store=…", { ttl: 60_000 });
//   invalidate("/admin/pos/sales");       // tras cobrar
//   prefetch("/admin/sales-analytics/insights?from=…");
//
// El módulo no sabe pedir nada por sí mismo: adminApi.js le da el `fetcher`
// (la llamada autenticada) con `configureCache`. Así no hay import circular.
import { useCallback, useEffect, useRef, useState } from "react";

const LS_PREFIX = "adm.cache:";
const DEFAULT_TTL = 60_000;
/** Por encima de esto una entrada no se guarda en sessionStorage (cuota ~5 MB por origen). */
const MAX_PERSIST_BYTES = 400_000;

const mem = new Map(); // url → { data, at }
const inflight = new Map(); // url → Promise
const subs = new Map(); // url → Set<(entry) => void>
let fetcher = null;
let enabled = true;

/** adminApi.js registra aquí la llamada autenticada: `(url) => Promise<data>`. */
export function configureCache({ fetcher: fn, enabled: on = true } = {}) {
  if (typeof fn === "function") fetcher = fn;
  enabled = on;
}

const now = () => Date.now();
const readLs = (url) => {
  try {
    const raw = sessionStorage.getItem(LS_PREFIX + url);
    if (!raw) return null;
    const e = JSON.parse(raw);
    return e && typeof e.at === "number" ? e : null;
  } catch { return null; }
};
const writeLs = (url, entry) => {
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > MAX_PERSIST_BYTES) return;
    sessionStorage.setItem(LS_PREFIX + url, raw);
  } catch { /* cuota llena o navegación privada: queda solo en memoria */ }
};
const dropLs = (url) => { try { sessionStorage.removeItem(LS_PREFIX + url); } catch { /* noop */ } };

/** La entrada de una URL (memoria primero, sessionStorage después) o null. */
function entryOf(url) {
  const e = mem.get(url);
  if (e) return e;
  const ls = readLs(url);
  if (ls) mem.set(url, ls);
  return ls || null;
}

/** El dato guardado de una URL, sin pedir nada (undefined si no hay). */
export const peek = (url) => entryOf(url)?.data;

function notify(url, payload) {
  const set = subs.get(url);
  if (!set) return;
  for (const cb of [...set]) { try { cb(payload); } catch { /* un suscriptor roto no para a los demás */ } }
}

/** Pide (o reutiliza la petición en vuelo) y guarda. */
function load(url, fn) {
  const cur = inflight.get(url);
  if (cur) return cur;
  const p = Promise.resolve()
    .then(() => (fn || fetcher)(url))
    .then((data) => {
      const entry = { data, at: now() };
      mem.set(url, entry);
      writeLs(url, entry);
      inflight.delete(url);
      notify(url, { data, error: null });
      return data;
    })
    .catch((err) => {
      inflight.delete(url);
      notify(url, { error: err });
      throw err;
    });
  inflight.set(url, p);
  return p;
}

/**
 * Lee una URL con caché. Con dato fresco (más joven que `ttl`) resuelve con
 * él sin pedir nada; con dato viejo resuelve con él YA y refresca por detrás;
 * sin dato, pide y espera. `force` salta la caché (pero no la de-duplicación).
 * `fetcher` sustituye al global para esa llamada.
 */
export function cachedGet(url, { ttl = DEFAULT_TTL, force = false, fetcher: fn } = {}) {
  if (!enabled) return (fn || fetcher)(url);
  const e = force ? null : entryOf(url);
  if (!e) return load(url, fn);
  if (now() - e.at > ttl) load(url, fn).catch(() => {});
  return Promise.resolve(e.data);
}

/** Lee por adelantado (hover sobre una pestaña): nunca falla hacia fuera. */
export function prefetch(url, opts) {
  return cachedGet(url, opts).catch(() => undefined);
}

/**
 * Olvida las entradas cuya URL empieza por `prefix` ("" = todas) y vuelve a
 * pedir las que tengan a alguien suscrito, para que la pantalla abierta se
 * actualice sola tras la mutación.
 */
export function invalidate(prefix = "") {
  const keys = new Set();
  for (const k of mem.keys()) if (k.startsWith(prefix)) keys.add(k);
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(LS_PREFIX) && k.slice(LS_PREFIX.length).startsWith(prefix)) keys.add(k.slice(LS_PREFIX.length));
    }
  } catch { /* noop */ }
  for (const k of keys) { mem.delete(k); dropLs(k); }
  for (const [k, set] of subs) if (k.startsWith(prefix) && set.size && fetcher) load(k).catch(() => {});
  return keys.size;
}

/** Al cerrar sesión: nada de una cuenta debe verse desde la siguiente. */
export function clearCache() {
  mem.clear();
  inflight.clear();
  try {
    const dead = [];
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.startsWith(LS_PREFIX)) dead.push(k); }
    dead.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* noop */ }
}

/** Suscribe a los cambios de una URL; devuelve la baja. */
export function subscribe(url, cb) {
  if (!subs.has(url)) subs.set(url, new Set());
  subs.get(url).add(cb);
  return () => { const set = subs.get(url); if (set) { set.delete(cb); if (!set.size) subs.delete(url); } };
}

/** Cuántas entradas hay en memoria (para medir en el banco de pruebas). */
export const cacheSize = () => mem.size;

/**
 * Hook: { data, loading, error, refresh }. `data` es lo guardado desde el
 * primer pintado (sin parpadeo al volver a una pestaña); `loading` solo es
 * true mientras no hay NADA que enseñar. `enabled: false` no pide (p. ej.
 * hasta tener el contexto). `refresh()` vuelve a pedir saltando la caché.
 */
export function useCached(url, { ttl = DEFAULT_TTL, enabled: on = true, fetcher: fn } = {}) {
  const key = on && url ? url : null;
  const [state, setState] = useState(() => {
    const e = key ? entryOf(key) : null;
    return { data: e ? e.data : undefined, error: null, loading: Boolean(key) && !e, url: key };
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!key) { setState((s) => (s.url === null && !s.loading ? s : { data: undefined, error: null, loading: false, url: null })); return undefined; }
    let alive = true;
    const e = entryOf(key);
    setState((s) => (s.url === key && s.data === e?.data && !s.loading === Boolean(e) ? s : { data: e ? e.data : undefined, error: null, loading: !e, url: key }));
    const off = subscribe(key, ({ data, error }) => {
      if (!alive) return;
      if (error) setState((s) => ({ ...s, error, loading: false }));
      else setState({ data, error: null, loading: false, url: key });
    });
    cachedGet(key, { ttl, fetcher: fnRef.current })
      .then((data) => { if (alive) setState((s) => (s.data === data && !s.loading ? s : { data, error: null, loading: false, url: key })); })
      .catch((error) => { if (alive) setState((s) => ({ ...s, error, loading: false })); });
    return () => { alive = false; off(); };
  }, [key, ttl]);
  const refresh = useCallback(() => (key ? cachedGet(key, { force: true, fetcher: fnRef.current }).catch(() => undefined) : Promise.resolve()), [key]);
  return { data: state.data, loading: state.loading, error: state.error, refresh };
}
