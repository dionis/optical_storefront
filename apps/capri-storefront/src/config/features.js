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

// Virtual try-on (camera + 3D frame overlay, TryOn3D.jsx). Enabled by default; set
// VITE_ENABLE_TRY_ON=false to hide the buttons on the product card and the PDP.
//
// TryOn3D.jsx is just an iframe onto apps/vto-web — no three.js in this bundle, so
// unlike the old React-native probador there is no extra chunk to strip when the flag
// is off; hiding the button is enough.
// Default OFF por decisión de producto (probador desactivado en todo el sitio).
// Para reactivarlo en desarrollo: VITE_ENABLE_TRY_ON=true en tu .env.
export const TRY_ON_ENABLED = flag(env.VITE_ENABLE_TRY_ON, false);

export default { TRY_ON_ENABLED };
