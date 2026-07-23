// Live catalog store.
// The bundled static data (products.js / cases.js) is the SEED shown on first paint and
// used as an offline fallback. On startup we fetch /catalog.json and /cases.json — the
// files the daily sync service regenerates from caprioptics' Store API (only in-stock
// frames) — and swap them in. Any component using useCatalog() re-renders on update.
import { useSyncExternalStore } from "react";
import { enrichProducts, PRODUCTS as SEED_PRODUCTS, SEED_FRAMES } from "./products.js";
import { enrichCases, CASES as SEED_CASES, SEED_CASES as SEED_CASES_RAW } from "./cases.js";
import { subscribe as onPrices } from "../admin/priceStore.js";

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
