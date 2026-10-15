// Live catalog store.
// The bundled static data (products.js / cases.js) is the SEED shown on first paint and
// used as an offline fallback. On startup we fetch /catalog.json and /cases.json — the
// files the daily sync service regenerates from caprioptics' Store API (only in-stock
// frames) — and swap them in. Any component using useCatalog() re-renders on update.
import { useSyncExternalStore } from "react";
import { enrichProducts, PRODUCTS as SEED_PRODUCTS, SEED_FRAMES } from "./products.js";
import { enrichCases, CASES as SEED_CASES, SEED_CASES as SEED_CASES_RAW } from "./cases.js";
import { subscribe as onPrices } from "../admin/priceStore.js";
import { USE_MEDUSA } from "./medusa.js";
import { loadFromMedusa } from "./medusaCatalog.js";

function hash(str){let h=0;const s=String(str);for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))&0xffffffff;return Math.abs(h);}
const bySlug = (arr) => Object.fromEntries(arr.map((p) => [p.slug, p]));

// keep the RAW (pre-enrichment) arrays so we can re-price live when the owner edits prices
let rawFrames = SEED_FRAMES;
let rawCases = SEED_CASES_RAW;

let state = {
  products: SEED_PRODUCTS,
  cases: SEED_CASES,
  productBySlug: bySlug(SEED_PRODUCTS),
  caseBySlug: bySlug(SEED_CASES),
  meta: null,
  live: false,
  // `loading` is true from first paint until the startup live-load (loadLive)
  // settles. Deep-linked pages (/producto/:slug, /recetas/:slug) must wait on it
  // before deciding "not found": under Medusa the real catalog — and thus the
  // slug being visited — only exists after the fetch resolves, so a synchronous
  // not-found check against the bundled seed would falsely reject valid links.
  loading: true,
};

// re-enrich (re-apply prices) when the admin changes any override.
// Under Medusa the backend catalog is the single source of truth for prices, so
// we must NOT re-enrich from the bundled seed here — doing so clobbers the real
// Medusa prices with the local placeholder prices a moment after load (the
// "prices flip back to the old values when idle" bug). Only re-price the local
// seed catalog when NOT running against Medusa.
onPrices(() => {
  if (USE_MEDUSA) return;
  const products = enrichProducts(rawFrames);
  const ecases = enrichCases(rawCases);
  set({ products, cases: ecases, productBySlug: bySlug(products), caseBySlug: bySlug(ecases) });
});

const subs = new Set();
function emit() { for (const f of subs) f(); }
function set(next) { state = { ...state, ...next }; emit(); }

export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
export function getState() { return state; }

// Resolve a product from a URL slug that may be a SHORT seed slug ("dc406") OR a
// full Medusa handle ("dc406-di-caprio"). A link can be built from the seed
// catalog (short slug) a moment before the Medusa catalog — keyed by handle —
// finishes loading; without this, that link would render "product not found"
// even though the product exists. Falls back to matching by sku/handle/prefix.
const _normKey = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function matchProduct(slug, bySlugMap, list) {
  if (!slug) return null;
  if (bySlugMap && bySlugMap[slug]) return bySlugMap[slug];
  const key = _normKey(slug);
  return (
    (list || []).find(
      (p) =>
        _normKey(p.slug) === key ||
        _normKey(p.sku) === key ||
        (p.slug && String(p.slug).startsWith(slug + "-")) ||
        (p.handle && p.handle === slug)
    ) || null
  );
}

// Where the daily cloud service publishes the catalog. Defaults to same-origin
// (public/*.json), but for the SaaS/cloud deployment set VITE_CATALOG_URL to the
// hosted base (e.g. https://cdn.myshop.com/catalog) so the storefront reads the
// cloud-generated catalog directly, decoupled from any local machine.
const BASE = (import.meta.env && import.meta.env.VITE_CATALOG_URL
  ? String(import.meta.env.VITE_CATALOG_URL).replace(/\/$/, "")
  : "");

// When the live catalog was last fetched successfully, and whether a fetch is in
// flight. A boolean "loaded once" flag meant a tab left open all afternoon never
// saw a price or stock change — the catalog was pinned to whatever existed at
// first paint. Now the load can repeat, and does (see startAutoRevalidate).
let lastLoadedAt = 0;
let inFlight = null;

// How stale the catalog may get before a revalidation is worth doing. Short
// enough that a price edit reaches an open tab within the hour, long enough that
// tab-switching doesn't turn into a request per switch.
const MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Fetch the live catalog. Repeat calls inside MAX_AGE_MS are no-ops, and
 * concurrent calls share one request.
 *
 * `force` skips the freshness check (used by the revalidation triggers). The
 * swap is silent by design: `state` feeds useSyncExternalStore, so every screen
 * re-renders with the new data on its own — the shopper is never asked to
 * reload, and never sees a "refresh?" prompt.
 */
export async function loadLive({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (!force && lastLoadedAt && Date.now() - lastLoadedAt < MAX_AGE_MS) return;
  inFlight = doLoad();
  try { await inFlight; } finally { inFlight = null; }
}

async function doLoad() {

  // Whichever branch runs (and however it exits — success, early return, or
  // error) the live-load attempt is over once we leave: clear `loading` so
  // deep-linked pages can decide found/not-found against the settled catalog.
  try {
    // Medusa path (Phase 1): the Store API is the source of truth. Prices/attributes
    // come already computed from the backend — no priceStore/enrichment re-pricing.
    if (USE_MEDUSA) {
      try {
        const { products, cases } = await loadFromMedusa();
        if (Array.isArray(products) && products.length) {
          set({
            products,
            cases: cases.length ? cases : state.cases,
            productBySlug: bySlug(products),
            caseBySlug: bySlug(cases.length ? cases : state.cases),
            meta: { source: "medusa" },
            live: true,
          });
          // Only a successful swap counts as "fresh". After a failure the age
          // check stays expired, so the next trigger retries instead of waiting
          // out MAX_AGE_MS on data we never actually got.
          lastLoadedAt = Date.now();
        }
      } catch (e) {
        // network/SDK error → keep the bundled seed silently
      }
      return;
    }

    try {
      const opt = { cache: "no-store" };
      const [cRes, kRes] = await Promise.all([fetch(`${BASE}/catalog.json`, opt), fetch(`${BASE}/cases.json`, opt)]);
      if (!cRes.ok || !kRes.ok) return; // keep seed
      const frames = await cRes.json();
      const cases = await kRes.json();
      if (!Array.isArray(frames) || !frames.length) return;
      let meta = null;
      try { const m = await fetch(`${BASE}/catalog-meta.json`, opt); if (m.ok) meta = await m.json(); } catch { /* ignore */ }
      rawFrames = frames;
      if (Array.isArray(cases) && cases.length) rawCases = cases;
      const products = enrichProducts(rawFrames);
      const ecases = enrichCases(rawCases);
      set({
        products,
        cases: ecases.length ? ecases : state.cases,
        productBySlug: bySlug(products),
        caseBySlug: bySlug(ecases.length ? ecases : state.cases),
        meta,
        live: true,
      });
      lastLoadedAt = Date.now();
    } catch (e) {
      // network/parse error → keep the bundled seed silently
    }
  } finally {
    set({ loading: false });
  }
}

/**
 * Keep an open tab's catalog current without the shopper doing anything.
 *
 * Revalidates when the tab becomes visible again (the moment that matters: a tab
 * parked for an hour is exactly the one showing yesterday's prices) and when the
 * browser reports the network coming back. `loadLive` throttles by MAX_AGE_MS,
 * so these triggers can fire freely.
 *
 * Returns a teardown function. Safe to call outside a browser (SSR/tests).
 */
export function startAutoRevalidate() {
  if (typeof document === "undefined") return () => {};
  const onVisible = () => { if (!document.hidden) loadLive(); };
  const onOnline = () => loadLive({ force: true });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
  };
}

export function recommendedCases(seed, n = 3) {
  const pool = state.cases;
  if (!pool.length) return [];
  const start = hash(seed || "x") % pool.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

export function useCatalog() {
  return useSyncExternalStore(subscribe, getState, getState);
}
