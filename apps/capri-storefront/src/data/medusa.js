// Single Medusa Store API client for the storefront.
// Phase 0 of the "connect storefront to Medusa" plan: this only wires up the SDK
// so the SPA *can* talk to the backend. Nothing consumes it yet — feature-gated by
// USE_MEDUSA so old (static JSON) and new (Medusa) data paths can coexist during
// the incremental migration.
//
// Config comes from Vite env vars (see .env.example):
//   VITE_MEDUSA_URL             - base URL of the Medusa backend Store API
//   VITE_MEDUSA_PUBLISHABLE_KEY - publishable API key bound to the sales channel
//   VITE_USE_MEDUSA             - "true" to route data through Medusa
//
// Env vars may be undefined at build time (e.g. Vercel preview without config).
// We fall back to the local dev URL and never throw at module load, so the bundle
// always builds; a missing publishable key just means Store API calls will 401 at
// runtime, which is fine until Phase 1 actually starts using this client.
import Medusa from "@medusajs/js-sdk";

const env = (import.meta && import.meta.env) || {};

// Backend base URL. Two modes, chosen by VITE_MEDUSA_URL:
//   • absolute http(s) URL  → direct mode (the browser talks to the backend and
//                             the backend must send CORS headers for our origin);
//   • empty or a "/path"    → same-origin PROXY mode (default). All Store API
//                             calls go to `${origin}/medusa/...`, which the Vercel
//                             rewrite and the Vite dev proxy forward to the
//                             backend. The browser only ever hits its own origin,
//                             so there is no CORS to configure. This matches how
//                             the production storefront already reaches the
//                             catalog, and is the mode we deploy with.
const RAW_MEDUSA_URL = env.VITE_MEDUSA_URL || "";
const IS_ABSOLUTE_URL = /^https?:\/\//i.test(RAW_MEDUSA_URL);
const PROXY_PATH = RAW_MEDUSA_URL && !IS_ABSOLUTE_URL ? RAW_MEDUSA_URL : "/medusa";
const ORIGIN = typeof window !== "undefined" && window.location ? window.location.origin : "";

export const MEDUSA_URL = IS_ABSOLUTE_URL ? RAW_MEDUSA_URL : (ORIGIN + PROXY_PATH);
export const MEDUSA_PUBLISHABLE_KEY = env.VITE_MEDUSA_PUBLISHABLE_KEY || "";

// Feature flag to switch data sources page-by-page during the migration.
export const USE_MEDUSA = env.VITE_USE_MEDUSA === "true";

export const medusa = new Medusa({
  baseUrl: MEDUSA_URL,
  publishableKey: MEDUSA_PUBLISHABLE_KEY,
  // Persist customer JWTs in localStorage so sessions survive reloads (Phase 4).
  auth: { type: "jwt" },
});

export default medusa;
