// Live catalog store.
// The bundled static data (products.js / cases.js) is the SEED shown on first paint and
// used as an offline fallback. On startup we fetch /catalog.json and /cases.json — the
// files the daily sync service regenerates from caprioptics' Store API (only in-stock
// frames) — and swap them in. Any component using useCatalog() re-renders on update.
import { useSyncExternalStore } from "react";
import { enrichProducts, PRODUCTS as SEED_PRODUCTS } from "./products.js";
import { enrichCases, CASES as SEED_CASES } from "./cases.js";

function hash(str){let h=0;const s=String(str);for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))&0xffffffff;return Math.abs(h);}
const bySlug = (arr) => Object.fromEntries(arr.map((p) => [p.slug, p]));

let state = {
  products: SEED_PRODUCTS,
  cases: SEED_CASES,
  productBySlug: bySlug(SEED_PRODUCTS),
  caseBySlug: bySlug(SEED_CASES),
  meta: null,
  live: false,
};

const subs = new Set();
function emit() { for (const f of subs) f(); }
function set(next) { state = { ...state, ...next }; emit(); }

export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
export function getState() { return state; }

let loaded = false;
export async function loadLive() {
  if (loaded) return;
  loaded = true;
  try {
    const opt = { cache: "no-store" };
    const [cRes, kRes] = await Promise.all([fetch("/catalog.json", opt), fetch("/cases.json", opt)]);
    if (!cRes.ok || !kRes.ok) return; // keep seed
    const frames = await cRes.json();
    const cases = await kRes.json();
    if (!Array.isArray(frames) || !frames.length) return;
    let meta = null;
    try { const m = await fetch("/catalog-meta.json", opt); if (m.ok) meta = await m.json(); } catch { /* ignore */ }
    const products = enrichProducts(frames);
    const ecases = enrichCases(Array.isArray(cases) ? cases : []);
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
