// Dónde se usa: AdminShell.jsx. Cada tienda viste el panel con su color (el de
// Tiendas → Editar, el mismo de sus correos) para que quien vende sepa siempre
// dónde está. Dueño y superadmin, que no están en una sola tienda, ven grises y
// negro. Las variables se ponen SOLO en el armazón (`.adm-shell`), nunca en
// `:root`: la tienda pública no cambia.
//
// Cómo se decide la tienda activa (todo del servidor; aquí no hay nombres):
//  · `seller`: la tienda de su ficha (`assigned` en /admin/pos/context).
//  · `manager`/`supervisor` con una sola tienda: esa. Con varias: la última
//    elegida en el punto de venta (`pos_store`) o la fijada con
//    `setActiveStore()`; si ninguna, neutro y la barra lista sus códigos.
//  · `owner`/`superadmin`: neutro, salvo que algo fije una tienda con
//    `setActiveStore()` (p. ej. el POS al elegir caja o el filtro de tienda).
//
// Política de color (decisión del dueño): el color de una tienda es señal de
// que SE ESTÁ OPERANDO en ella. Para dueño y superadmin el cromo solo se tiñe
// en las pestañas operativas (`OPERATIONAL_TABS`: vender, caja, ventas,
// cobros) y mientras haya una tienda elegida; en las informativas (Ejecutivo,
// Estado de tienda, Pedidos, Tiendas, Equipo…) el cromo es el del superadmin,
// gris y negro, aunque el filtro tenga una tienda: el filtro y la píldora
// siguen enseñando el punto de su color, pero no la barra. El personal de
// tienda (vendedor, supervisor, encargado) vive en una tienda y la ve en
// color en todas partes.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isDemoLogin } from "./adminAuth.js";
import { adminGet } from "./adminApi.js";
import { peek } from "./adminCache.js";
import { ONLINE_STORE_COLOR, storeInk } from "./adminStores.js";
import { posContext } from "./posApi.js";

/** Las tiendas con su color, con caché (adminCache.js): cada `useStoreFilter` del panel la comparte. */
const fetchStoresCached = () => adminGet("/admin/establishments", { ttl: 300_000 });

/**
 * La lista de tiendas vive en el MÓDULO, no en cada pantalla.
 *
 * Antes cada `useStoreFilter` tenía su propio `useState({ stores: [] })`, así
 * que al cambiar de pestaña la pantalla nueva arrancaba con la lista vacía y
 * la tienda elegida no se podía resolver (`stores.find(...)` sobre nada) hasta
 * que volvía la promesa: el filtro parpadeaba a «Todas las tiendas» y parecía
 * que la elección se perdía al moverse de una ventana a otra. Compartiéndola
 * aquí, la segunda pantalla ya la tiene en el primer render.
 *
 * La petición se hace UNA vez por sesión (`loading` la comparte quien llegue a
 * la vez) y, si la caché de lecturas ya la tiene, se siembra sin esperar nada.
 */
const STORES_URL = "/admin/establishments";
let snapshot = { stores: [], assigned: null, loaded: false, forUser: null };
let loading = null;
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };
const subscribeStores = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getStoresSnapshot = () => snapshot;

/** Lo que la caché ya tenga, sin esperar: evita el primer render en blanco. */
function seedFromCache() {
  if (snapshot.loaded) return;
  const cached = peek(STORES_URL);
  const stores = (cached?.establishments || []).filter((x) => x.is_active !== false);
  if (stores.length) snapshot = { ...snapshot, stores };
}

/**
 * Carga las tiendas una sola vez por persona; `isAdmin` decide de qué ruta
 * salen. La instantánea recuerda de QUIÉN es: si entra otra persona (cerrar
 * sesión y volver a entrar), sus tiendas no son las de la anterior y se
 * vuelven a pedir. Así no hace falta que el cierre de sesión sepa de esto.
 */
function loadStores(isAdmin, userId = null) {
  // Solo se tira lo cargado cuando ya era de OTRA persona conocida: `forUser`
  // nulo es lo sembrado desde la caché al cargar el módulo, que todavía no
  // tiene dueño y no hay que descartar — era justo lo que evitaba el parpadeo.
  if (snapshot.forUser !== null && snapshot.forUser !== userId && !loading) {
    snapshot = { stores: [], assigned: null, loaded: false, forUser: userId };
    emit();
  }
  if (snapshot.loaded || loading) return loading;
  loading = (async () => {
    let stores = [];
    let assigned = null;
    if (isAdmin) {
      // Dueño/superadmin leen las tiendas con su color (/admin/establishments).
      try { stores = ((await fetchStoresCached())?.establishments || []).filter((x) => x.is_active !== false); } catch { /* sin tema */ }
    } else {
      // Los demás roles solo llegan a /admin/pos/context (sus tiendas y su caja).
      try {
        const c = await posContext();
        stores = c?.stores || [];
        assigned = c?.assigned?.establishment_id ?? null;
      } catch { /* sin tema */ }
    }
    snapshot = { stores, assigned, loaded: true, forUser: userId };
    loading = null;
    emit();
  })();
  return loading;
}

// Se siembra al cargar el módulo, no dentro de un efecto: `useSyncExternalStore`
// exige que la instantánea no cambie a mitad de un render, y sembrarla después
// la habría cambiado sin avisar a los suscritos.
seedFromCache();

/** Grises y negro: nadie está en una tienda concreta. */
export const NEUTRAL_THEME = { chrome: "#111827", accent: "#374151", bg: "#F3F4F6" };

/**
 * Pestañas en las que se OPERA una tienda (vender, caja, ventas del día,
 * cobros pendientes): las únicas en las que dueño y superadmin ven el panel
 * del color de la tienda elegida. El resto es información y sale en neutro.
 */
export const OPERATIONAL_TABS = new Set(["pos", "cash", "possales", "pendingbalances"]);

/* Fondo y tarjetas del modo oscuro (los mismos valores que --adm-bg/--adm-surface
   en admin.css bajo `[data-mode="dark"]`): la mezcla en JS es el respaldo del
   navegador sin color-mix(). */
const DARK_BG = "#0F1218";
const DARK_SURFACE = "#171B24";

/**
 * Color por defecto de las tiendas del dueño, por nombre, para una tienda que
 * aún no tiene color (la migración CreateEstablishmentThemeColor5 escribe la
 * misma tabla en la base; esto cubre el caso de que falte). El dueño puede
 * cambiarlo cuando quiera en Tiendas → Editar, y entonces manda lo guardado.
 *   Fry Family Clinic → verde clínica  #1B7F4C
 *   El Rancho 39      → cobre          #B5651D
 *   El Rancho 41      → fucsia         #C2185B
 *   Tienda online     → azul de la web #0E5AD0 (canal «web», no es establecimiento)
 *   Dueño/superadmin sin tienda → grises y negro (NEUTRAL_THEME)
 */
export function defaultColorForStore(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return null;
  if (n.includes("fry")) return "#1B7F4C";
  if (/rancho.*39/.test(n)) return "#B5651D";
  if (/rancho.*41/.test(n)) return "#C2185B";
  if (/online|\bweb\b/.test(n)) return ONLINE_STORE_COLOR;
  return null;
}

/** La tienda online como pseudo-tienda del tema (`setActiveStore(WEB_STORE.id)`). */
export const WEB_STORE = Object.freeze({ id: "web", code: "WEB", name: "", online: true, color: ONLINE_STORE_COLOR });

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** `b` pesa `w` (0–1) sobre `a`; respaldo en JS de `color-mix(in srgb, …)`. */
export function mixColor(a, b, w) {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v * (1 - w) + y[i] * w));
}
const darken = (c, p) => mixColor(c, "#000000", p);

/**
 * Tema a partir del color de una tienda (`#RRGGBB`); sin color válido o con
 * `neutral`, el gris. `surface` queda blanca: solo cambia el cromo, no las tarjetas.
 */
export function themeFor(color, { neutral = false, key = "neutral" } = {}) {
  const valid = !neutral && HEX.test(color || "");
  const accent = valid ? color.toUpperCase() : NEUTRAL_THEME.accent;
  const chrome = valid ? darken(accent, 0.15) : NEUTRAL_THEME.chrome;
  return {
    key: valid ? key : "neutral",
    neutral: !valid,
    accent,
    ink: storeInk(accent),
    bg: valid ? mixColor("#FFFFFF", accent, 0.07) : NEUTRAL_THEME.bg,
    surface: "#FFFFFF",
    chrome,
    chromeInk: storeInk(chrome),
    soft: mixColor("#FFFFFF", accent, 0.12),
  };
}

/**
 * Variables CSS del tema, para el `style` del armazón (admin-theme.css las
 * consume). `--st-bg` y `--st-soft` las deriva la hoja con `color-mix()` del
 * acento; estas `*-fallback` son la misma mezcla hecha aquí, para el navegador
 * que no lo tenga (un valor en línea le ganaría siempre a la hoja). En modo
 * oscuro la mezcla va sobre el fondo oscuro (acento al 12 %), no sobre blanco.
 * Las tarjetas (`--st-surface`) las pone la hoja desde `--adm-surface`, que
 * cambia con el modo.
 */
export const themeVars = (th, { dark = false } = {}) => ({
  "--st-accent": th.accent,
  "--st-ink": th.ink,
  "--st-bg-fallback": dark ? (th.neutral ? DARK_BG : mixColor(DARK_BG, th.accent, 0.12)) : th.bg,
  "--st-chrome": th.chrome,
  "--st-chrome-ink": th.chromeInk,
  "--st-soft-fallback": dark ? mixColor(DARK_SURFACE, th.accent, 0.22) : th.soft,
});

/* ── Modo claro / oscuro / sistema ─────────────────────────────────────── */
const MODE_KEY = "adm_color_mode";
export const COLOR_MODES = ["light", "dark", "system"];
const MQ = "(prefers-color-scheme: dark)";
const readMode = () => { const m = read(MODE_KEY); return COLOR_MODES.includes(m) ? m : "system"; };
const systemDark = () => typeof window !== "undefined" && !!window.matchMedia?.(MQ).matches;

/**
 * Modo de color del panel, guardado en `localStorage` (`adm_color_mode`):
 * `light`, `dark` o `system` (sigue a `prefers-color-scheme` y cambia al vuelo).
 * Devuelve { mode, resolved: "light"|"dark", cycle }; `cycle` pasa al siguiente
 * (claro → oscuro → sistema). El armazón lo aplica como `data-mode`.
 */
export function useColorMode() {
  const [mode, setMode] = useState(readMode);
  const [sysDark, setSysDark] = useState(systemDark);
  useEffect(() => {
    const mq = window.matchMedia?.(MQ);
    if (!mq) return undefined;
    const onChange = (e) => setSysDark(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  useEffect(() => {
    const refresh = () => setMode(readMode());
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const cycle = () => setMode((m) => {
    const next = COLOR_MODES[(COLOR_MODES.indexOf(m) + 1) % COLOR_MODES.length];
    try { localStorage.setItem(MODE_KEY, next); } catch { /* noop */ }
    return next;
  });
  const resolved = mode === "system" ? (sysDark ? "dark" : "light") : mode;
  return { mode, resolved, cycle };
}

/* ── Tienda activa fijada desde fuera (POS, informes…) ── */
const ACTIVE_KEY = "adm_active_store";
const POS_KEY = "pos_store"; // la que PosSale.jsx recuerda
const EVENT = "adm:active-store";
const read = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };

/** Fija (o quita, con null) la tienda que viste el panel; la barra cambia al instante. */
export function setActiveStore(id) {
  try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch { /* noop */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: id || null }));
}

const activeHint = () => read(ACTIVE_KEY) || read(POS_KEY);

/**
 * Tema del panel para `me` (GET /admin/team/me). Devuelve
 * { theme, storeTheme, store, stores, multi, operational }:
 *  · `store` es la activa (o null) y `stores` las suyas con color; `multi` si
 *    tiene varias y ninguna activa (la barra enseña sus códigos).
 *  · `storeTheme` es el tema de la tienda activa, siempre (el punto de color
 *    del filtro y de la píldora salen de aquí).
 *  · `theme` es el que viste el cromo: para dueño y superadmin es `storeTheme`
 *    solo en una pestaña de `OPERATIONAL_TABS` (`tab`, la que AdminShell
 *    pasa) y neutro en las demás; para el personal de tienda, siempre
 *    `storeTheme`. Sin `tab` (otros consumidores, p. ej. el filtro de tienda)
 *    no se aplica la política y `theme` es `storeTheme`.
 */
export function useStoreTheme(me, { tab } = {}) {
  const isAdmin = !me || me.is_admin !== false;
  const data = useSyncExternalStore(subscribeStores, getStoresSnapshot, getStoresSnapshot);
  const [hint, setHint] = useState(activeHint);

  useEffect(() => {
    if (!me || isDemoLogin()) return;
    // Una sola petición por sesión; lo que la caché tuviera ya se sembró arriba.
    loadStores(isAdmin, me?.id ?? null);
  }, [me?.id, me?.role, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refresh = () => setHint(activeHint());
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);

  return useMemo(() => {
    const { stores, assigned } = data;
    // "web" es la tienda online: no está en la lista porque no es un establecimiento.
    const byId = (id) => (id === WEB_STORE.id ? WEB_STORE : id ? stores.find((s) => s.id === id) || null : null);
    let store = null;
    if (!isAdmin) store = byId(assigned) || byId(hint) || (stores.length === 1 ? stores[0] : null);
    else store = byId(read(ACTIVE_KEY));
    // Sin color guardado, el que le toca por nombre (defaultColorForStore); sin eso, neutro.
    const neutral = themeFor(null, { neutral: true });
    const storeTheme = store ? themeFor(store.color || defaultColorForStore(store.name), { key: store.id }) : neutral;
    // Política: el administrador solo "viste" la tienda donde opera (OPERATIONAL_TABS).
    const operational = tab == null ? true : OPERATIONAL_TABS.has(tab);
    const theme = isAdmin && !operational ? neutral : storeTheme;
    return { theme, storeTheme, store, stores, multi: !isAdmin && !store && stores.length > 1, operational };
  }, [data, hint, isAdmin, tab]);
}
