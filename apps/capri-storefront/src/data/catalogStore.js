// Live catalog store.
// The bundled static data (products.js / cases.js) is the SEED shown on first paint and
// used as an offline fallback. On startup we fetch /catalog.json and /cases.json — the
// files the daily sync service regenerates from caprioptics' Store API (only in-stock
// frames) — and swap them in. Any component using useCatalog() re-renders on update.
import { useSyncExternalStore } from "react";
import { enrichProducts, PRODUCTS as SEED_PRODUCTS, SEED_FRAMES } from "./products.js";
import { enrichCases, CASES as SEED_CASES, SEED_CASES as SEED_CASES_RAW } from "./cases.js";
import { ALLOWED_BRAND_SLUGS } from "./brands.js";
import { subscribe as onPrices, applyFrame } from "../admin/priceStore.js";
import { medusaEnabled, fetchMedusaFrames } from "./medusaCatalog.js";

function hash(str){let h=0;const s=String(str);for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))&0xffffffff;return Math.abs(h);}
const bySlug = (arr) => Object.fromEntries(arr.map((p) => [p.slug, p]));
// Solo mostramos monturas de las marcas activas (ver brands.js).
const inBrand = (arr) => (arr || []).filter((p) => ALLOWED_BRAND_SLUGS.has(p.brand_slug));

// keep the RAW (pre-enrichment) arrays so we can re-price live when the owner edits prices
let rawFrames = SEED_FRAMES;
let rawCases = SEED_CASES_RAW;

let state = {
  products: inBrand(SEED_PRODUCTS),
  cases: SEED_CASES,
  productBySlug: bySlug(inBrand(SEED_PRODUCTS)),
  caseBySlug: bySlug(SEED_CASES),
  meta: null,
  live: false,
};

// re-enrich (re-apply prices) when the admin changes any override
onPrices(() => {
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

  // ── Fuente 1: backend Medusa (si VITE_USE_MEDUSA). Fallback: catalog.json → seed. ──
  if (medusaEnabled()) {
    try {
      const frames = await fetchMedusaFrames();
      if (Array.isArray(frames) && frames.length) {
        rawFrames = frames;
        const products = inBrand(enrichProducts(frames)).map((p) =>
          p._medusaPrice != null
            ? { ...p, price: applyFrame(p.sku, p._medusaPrice), basePrice: p._medusaPrice,
                rating: p._medusaRating ?? p.rating, reviews: p._medusaReviews ?? p.reviews }
            : p
        );
        // Estuches: siguen desde cases.json (fallback al seed).
        let ecases = state.cases;
        try {
          const k = await fetch(`${BASE}/cases.json`, { cache: "no-store" });
          if (k.ok) { const cj = await k.json(); if (Array.isArray(cj) && cj.length) { rawCases = cj; ecases = enrichCases(cj); } }
        } catch { /* keep seed cases */ }
        if (products.length) {
          set({
            products,
            cases: ecases.length ? ecases : state.cases,
            productBySlug: bySlug(products),
            caseBySlug: bySlug(ecases.length ? ecases : state.cases),
            meta: { source: "medusa", count: products.length },
            live: true,
          });
          return;
        }
      }
    } catch (e) {
      // backend no disponible / error → caemos a catalog.json y luego al seed
    }
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
    const products = inBrand(enrichProducts(rawFrames));
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
