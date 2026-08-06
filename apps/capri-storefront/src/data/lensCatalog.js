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
import { useEffect, useState } from "react";
import { medusa, USE_MEDUSA } from "./medusa.js";
import { DESIGNS, MATERIALS, BASE, PHOTO, AR } from "./lensPricing.js";

/** The bundled 2026 list — first paint, offline, and fallback. */
export const STATIC_CATALOG = { DESIGNS, MATERIALS, BASE, PHOTO, AR };

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

  const base = {};
  for (const b of basePrices) {
    if (!base[b.design_code]) base[b.design_code] = {};
    base[b.design_code][b.material_code] = dollars(b.price_cents) ?? 0;
  }

  const ar = { sv: [], bifprog: [] };
  for (const a of ars) {
    if (!ar[a.ar_group]) ar[a.ar_group] = [];
    ar[a.ar_group].push({
      id: a.code,
      label: { es: a.label_es, en: a.label_en },
      price: dollars(a.price_cents) ?? 0,
    });
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
