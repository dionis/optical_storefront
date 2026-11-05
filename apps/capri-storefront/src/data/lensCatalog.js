// Backend → storefront adapter for the 2026 lens matrix.
//
// The backend owns the lens catalog (lens_design / lens_material / lens_base_price /
// lens_photo_option / lens_ar_option, each carrying label_es + label_en) and serves it
// at GET /store/lens-config/matrix. This module maps those rows to the exact shapes the
// wizard already consumes from lensPricing.js, so components need no restructuring.
//
// lensPricing.js stays as the offline fallback: it is what renders on first paint, when
// VITE_USE_MEDUSA is off, and whenever the request fails. Codes match one-for-one
// between the two ("sv", "cr39", "photo-grey", "ar-green-basic"…), which is also what
// keeps the admin price overrides in priceStore.js keyed correctly either way.
//
// Displayed prices remain an estimate only — the authoritative total for the cart comes
// from POST /store/lens-config/quote, never from this data.
import { useEffect, useMemo, useState } from "react";
import { medusa, USE_MEDUSA } from "./medusa.js";
import { DESIGNS, MATERIALS, BASE, FINISHES, PHOTO, AR, TREAT } from "./lensPricing.js";
// The panel's authenticated, cached GET (adminApi.js + adminCache.js). Both
// modules are self-contained (no UI, no catalog), so the public wizard's chunk
// only grows by the fetch helper; the admin hook below is the only user here.
import { adminGet, queryKey } from "../admin/adminApi.js";
import { useCached } from "../admin/adminCache.js";

/** The bundled 2026 list — first paint, offline, and fallback. */
export const STATIC_CATALOG = { DESIGNS, MATERIALS, BASE, FINISHES, PHOTO, AR, TREAT };

/** The finish a design is sold with unless the seller picks the other one (same rule as the backend's lib/lens-finish.ts). */
export const defaultFinishFor = (category) => (category === "prog" ? "digital" : "stock");

// The module stores integer USD cents; the storefront works in decimal dollars.
const dollars = (v) => (v == null ? null : Number(v) / 100);

/**
 * Maps a /store/lens-config/matrix payload to the wizard's shapes.
 * Returns null when the matrix is unusable, which makes callers keep STATIC_CATALOG.
 * Exported as a test seam.
 */
export function adaptLensMatrix(payload) {
  const designs = payload?.designs || [];
  const materials = payload?.materials || [];
  const basePrices = payload?.base_prices || [];
  const photos = payload?.photos || [];
  const ars = payload?.ars || [];

  // A partial matrix would silently strip options out of the wizard — treat it as a
  // failed load and keep the bundled list instead.
  if (!designs.length || !materials.length || !basePrices.length) return null;

  // BASE keeps the DEFAULT finish of each design (stock; digital for a
  // progressive), so the web wizard reads exactly what it always did.
  // FINISHES carries both cells for the POS, null where the owner has not
  // priced that finish. A row without `finish` (backend before the finish
  // migration) is the design's only cell.
  const categoryOf = Object.fromEntries(designs.map((d) => [d.code, d.category]));
  const base = {};
  const finishes = {};
  for (const b of basePrices) {
    const fallback = defaultFinishFor(categoryOf[b.design_code]);
    const finish = b.finish === "stock" || b.finish === "digital" ? b.finish : fallback;
    if (!finishes[b.design_code]) finishes[b.design_code] = {};
    if (!finishes[b.design_code][b.material_code]) finishes[b.design_code][b.material_code] = { stock: null, digital: null };
    finishes[b.design_code][b.material_code][finish] = dollars(b.price_cents) ?? 0;
    if (finish === fallback) {
      if (!base[b.design_code]) base[b.design_code] = {};
      base[b.design_code][b.material_code] = dollars(b.price_cents) ?? 0;
    }
  }

  const ar = { sv: [], bifprog: [] };
  for (const a of ars) {
    const opt = {
      id: a.code,
      label: { es: a.label_es, en: a.label_en },
      price: dollars(a.price_cents) ?? 0,
    };
    // ar_group "all" (AR Green / AR Blue nuevos) aplica a todos los diseños.
    if (a.ar_group === "all") { ar.sv.push(opt); ar.bifprog.push(opt); }
    else { if (!ar[a.ar_group]) ar[a.ar_group] = []; ar[a.ar_group].push(opt); }
  }

  // Matriz de tratamientos por (diseño × material). Si el backend aún no la
  // envía (antes de su migración), se usa la tabla de respaldo TREAT.
  const tps = payload?.treatment_prices || [];
  let treat = null;
  if (tps.length) {
    treat = {};
    for (const t of tps) {
      if (!treat[t.design_code]) treat[t.design_code] = {};
      if (!treat[t.design_code][t.material_code]) treat[t.design_code][t.material_code] = {};
      treat[t.design_code][t.material_code][t.treatment_code] = dollars(t.price_cents) ?? 0;
    }
  }

  return {
    DESIGNS: designs.map((d) => ({
      id: d.code,
      cat: d.category,
      rx: !!d.requires_rx,
      add: !!d.requires_add,
      label: { es: d.label_es, en: d.label_en },
    })),
    MATERIALS: materials.map((m) => ({
      id: m.code,
      maxAbs: Number(m.max_abs),
      label: { es: m.label_es, en: m.label_en },
      desc: { es: m.desc_es || "", en: m.desc_en || "" },
    })),
    BASE: base,
    FINISHES: finishes,
    PHOTO: photos.map((p) => ({
      id: p.code,
      colors: p.colors || [],
      label: { es: p.label_es, en: p.label_en },
      price: {
        sv: dollars(p.price_sv_cents),
        bifocal: dollars(p.price_bifocal_cents),
        prog: dollars(p.price_prog_cents),
      },
    })),
    AR: ar,
    TREAT: treat || TREAT,
  };
}

// One in-flight request per page load, shared by every caller.
let pending = null;

/** Resolves to the live catalog, or STATIC_CATALOG if Medusa is off/unreachable. */
export function loadLensCatalog() {
  if (pending) return pending;
  if (!USE_MEDUSA) {
    pending = Promise.resolve(STATIC_CATALOG);
    return pending;
  }
  pending = medusa.client
    .fetch("/store/lens-config/matrix")
    .then((r) => adaptLensMatrix(r) || STATIC_CATALOG)
    .catch(() => STATIC_CATALOG);
  return pending;
}

/** Test seam — drops the cached request so the next load refetches. */
export function resetLensCatalog() {
  pending = null;
}

/**
 * Lens catalog for the wizard. Renders the bundled list immediately and swaps in the
 * backend's once it arrives, so there is no loading state to handle. `live` reports
 * whether the data on screen came from the backend.
 */
export function useLensCatalog() {
  const [catalog, setCatalog] = useState(STATIC_CATALOG);

  useEffect(() => {
    let cancelled = false;
    const apply = (c) => { if (!cancelled) setCatalog(c); };
    loadLensCatalog().then(apply);

    // The wizard is the one screen a shopper leaves open while they hunt for
    // their prescription — long enough for the owner to edit the lens matrix in
    // the meantime. Re-fetch when they come back, so the prices they are picking
    // from are the ones the backend will actually charge. (The quote in
    // LensProcess is server-side either way; this keeps the menu honest.)
    const onVisible = () => {
      if (document.hidden) return;
      resetLensCatalog();
      loadLensCatalog().then(apply);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { ...catalog, live: catalog !== STATIC_CATALOG };
}

// ── The panel's copy (point of sale, statements, sales board) ────────────────
//
// GET /admin/pos/lens-matrix answers the same payload as the public route, with
// the chosen store's variations already applied (lib/lens-matrix.ts), through
// the admin session — no publishable key and no VITE_USE_MEDUSA involved. The
// deployed storefront builds never set that flag, so the till used to render
// the bundled list below and the owner's edits in «Precios y costos → Lentes»
// (digital finish cells included) never reached the picker.

/** The admin route; `store` empty = the master list. Also the cache prefix pricing/api.js invalidates on every lens-price write. */
export const ADMIN_LENS_MATRIX_PATH = "/admin/pos/lens-matrix";
const ADMIN_LENS_MATRIX_TTL = 60_000;

const adminMatrixKey = (storeId) => queryKey(ADMIN_LENS_MATRIX_PATH, { store: storeId || "" });

/**
 * Resolves to the catalog the panel should price from (store prices when
 * `storeId` is given), or STATIC_CATALOG when the route fails. Cached and
 * de-duplicated by adminCache.js like every other panel read.
 */
export function loadAdminLensCatalog(storeId = "") {
  return adminGet(ADMIN_LENS_MATRIX_PATH, { query: { store: storeId || "" }, ttl: ADMIN_LENS_MATRIX_TTL })
    .then((r) => adaptLensMatrix(r) || STATIC_CATALOG)
    .catch(() => STATIC_CATALOG);
}

/**
 * Lens catalog for the panel. Renders the bundled list until the backend's
 * arrives (and whenever it fails), then the live one; a change in
 * «Precios y costos» re-reads it through the cache's invalidation, and so does
 * coming back to the tab. `live` is false while the screen shows the bundled
 * fallback — the POS says so next to the picker, because then the finish
 * toggle and the option list may not match what the quote will accept.
 */
export function useAdminLensCatalog(storeId = "") {
  const { data, refresh } = useCached(adminMatrixKey(storeId), { ttl: ADMIN_LENS_MATRIX_TTL });
  const catalog = useMemo(() => (data ? adaptLensMatrix(data) : null) || STATIC_CATALOG, [data]);

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { ...catalog, live: catalog !== STATIC_CATALOG };
}
