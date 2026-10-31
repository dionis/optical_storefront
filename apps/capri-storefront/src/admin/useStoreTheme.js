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
//    `setActiveStore()` (p. ej. el POS al elegir caja).
import { useEffect, useMemo, useState } from "react";
import { isDemoLogin } from "./adminAuth.js";
import { fetchStores, storeInk } from "./adminStores.js";
import { posContext } from "./posApi.js";

/** Grises y negro: nadie está en una tienda concreta. */
export const NEUTRAL_THEME = { chrome: "#111827", accent: "#374151", bg: "#F3F4F6" };

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
 * que no lo tenga (un valor en línea le ganaría siempre a la hoja).
 */
export const themeVars = (th) => ({
  "--st-accent": th.accent,
  "--st-ink": th.ink,
  "--st-bg-fallback": th.bg,
  "--st-surface": th.surface,
  "--st-chrome": th.chrome,
  "--st-chrome-ink": th.chromeInk,
  "--st-soft-fallback": th.soft,
});

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
 * Tema del panel para `me` (GET /admin/team/me). Devuelve { theme, store, stores, multi }:
 * `store` es la activa (o null), `stores` las suyas con color, `multi` si tiene
 * varias y ninguna activa (la barra enseña sus códigos).
 */
export function useStoreTheme(me) {
  const isAdmin = !me || me.is_admin !== false;
  const [data, setData] = useState({ stores: [], assigned: null });
  const [hint, setHint] = useState(activeHint);

  useEffect(() => {
    if (!me || isDemoLogin()) { setData({ stores: [], assigned: null }); return undefined; }
    let alive = true;
    (async () => {
      let stores = [];
      let assigned = null;
      if (isAdmin) {
        // Dueño/superadmin leen las tiendas con su color (/admin/establishments).
        try { stores = ((await fetchStores())?.establishments || []).filter((s) => s.is_active !== false); } catch { /* sin tema */ }
      } else {
        // Los demás roles solo llegan a /admin/pos/context (sus tiendas y su caja).
        try {
          const c = await posContext();
          stores = c?.stores || [];
          assigned = c?.assigned?.establishment_id ?? null;
        } catch { /* sin tema */ }
      }
      if (alive) setData({ stores, assigned });
    })();
    return () => { alive = false; };
  }, [me?.id, me?.role, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refresh = () => setHint(activeHint());
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);

  return useMemo(() => {
    const { stores, assigned } = data;
    const byId = (id) => (id ? stores.find((s) => s.id === id) || null : null);
    let store = null;
    if (!isAdmin) store = byId(assigned) || byId(hint) || (stores.length === 1 ? stores[0] : null);
    else store = byId(read(ACTIVE_KEY));
    const theme = store ? themeFor(store.color, { key: store.id }) : themeFor(null, { neutral: true });
    return { theme, store, stores, multi: !isAdmin && !store && stores.length > 1 };
  }, [data, hint, isAdmin]);
}
