// Tenant identity for the storefront — the ONE place the SPA learns which
// store it is. Same idea as apps/backend/src/lib/tenant.ts: one deployment per
// store, built from this repo, differing only in configuration (see
// docs/MULTI-TENANT.md). Every value defaults to today's RUBI LENS so a build
// without the VITE_TENANT_* variables is byte-for-byte the current store.
//
// What is NOT here yet (tracked in the doc): the dictionary still names the
// brand in ~10 copy strings, index.html carries the SEO title/description, and
// the brand palette lives in CSS variables. Those move here as the second
// tenant appears; nothing in checkout, pricing or orders depends on them.

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const pick = (key, fallback) => {
  const v = env[key];
  return v && String(v).trim() ? String(v).trim() : fallback;
};

export const TENANT = Object.freeze({
  /** Brand name shown in titles, alt texts and page metadata. */
  name: pick("VITE_TENANT_NAME", "Óptica El Rancho"),
  /** Tagline appended to the brand in document titles. */
  tagline: pick("VITE_TENANT_TAGLINE", "Óptica y Salud Visual"),
  /** Logo paths (served from /public). */
  logo: pick("VITE_TENANT_LOGO", "/logo-oficial.png"),
  logoMark: pick("VITE_TENANT_LOGO_MARK", "/logo-oficial-mark.png"),
  /** Supplier credit shown in the footer; empty hides it. */
  imageCredit: pick("VITE_TENANT_IMAGE_CREDIT", "caprioptics.com"),
});

/** `"DC407 · Di Caprio | RUBI LENS"` — the document-title convention. */
export const pageTitle = (text) => `${text} | ${TENANT.name}`;
