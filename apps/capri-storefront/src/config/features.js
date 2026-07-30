// Storefront feature flags.
//
// Single place to turn optional storefront features on/off without touching
// components. Values come from Vite env vars (see .env.example) and are read
// once at module load, so they are inlined into the bundle at build time.
//
//   VITE_ENABLE_TRY_ON - "false" to hide every virtual try-on entry point
//
// Env vars may be undefined (e.g. a preview build without config), so every
// flag has an explicit default that preserves the current behaviour.

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

// Parses the loose values people actually write in .env files ("false", "0",
// "off", "no") instead of only accepting the exact string "true".
function flag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(v)) return true;
  if (["false", "0", "off", "no"].includes(v)) return false;
  return fallback;
}

// Virtual try-on (camera + three.js 3D frames). Enabled by default; set
// VITE_ENABLE_TRY_ON=false to hide the buttons on the product card and the PDP.
//
// This flag alone only stops the component from rendering: the dynamic import
// stays in the module graph, so Rollup still emits the ~560 kB three.js chunk
// (nobody downloads it, but it ships). Dropping it from the build takes the
// `disable-try-on` plugin in vite.config.js, which swaps TryOn.jsx for a stub
// when the flag is off. Both read the flag the same way — keep them in sync.
// Default OFF por decisión de producto (probador desactivado en todo el sitio).
// Para reactivarlo en desarrollo: VITE_ENABLE_TRY_ON=true en tu .env.
export const TRY_ON_ENABLED = flag(env.VITE_ENABLE_TRY_ON, false);

export default { TRY_ON_ENABLED };
