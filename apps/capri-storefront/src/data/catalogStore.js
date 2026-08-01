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

// Where the daily cloud service publishes the catalog. Defaults to same-origin
// (public/*.json), but for the SaaS/cloud deployment set VITE_CATALOG_URL to the
// hosted base (e.g. https://cdn.myshop.com/catalog) so the storefront reads the
// cloud-generated catalog directly, decoupled from any local machine.
const BASE = (import.meta.env && import.meta.env.VITE_CATALOG_URL
  ? String(import.meta.env.VITE_CATALOG_URL).replace(/\/$/, "")
  : "");

let loaded = false;
export async function loadLive() {
  if (loaded) return;
  loaded = true;

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
    } catch (e) {
      // network/parse error → keep the bundled seed silently
    }
  } finally {
    set({ loading: false });
  }
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
