// Tenant identity for the storefront — the ONE place the SPA learns which
// store it is. Same idea as apps/backend/src/lib/tenant.ts: one deployment per
// store, built from this repo, differing only in configuration (see
// docs/MULTI-TENANT-TECNICO.md).
//
// The values come from the tenant manifest (tenants/<slug>/tenant.json): the
// "tenant" Vite plugin (scripts/tenant/load.mjs) turns it into VITE_TENANT_* at
// build time, and a variable set by hand in Vercel wins over the manifest. The
// fallbacks below only matter for a build that bypasses vite.config.js.

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const pick = (key, fallback) => {
  const v = env[key];
  return v && String(v).trim() ? String(v).trim() : fallback;
};

import { runtimeLogo } from "./brandRuntime.js";

const BUILD_LOGO = pick("VITE_TENANT_LOGO", "/logo-oficial.png");
const BUILD_LOGO_MARK = pick("VITE_TENANT_LOGO_MARK", "/logo-oficial-mark.png");

export const TENANT = Object.freeze({
  /** Manifest slug ("el-rancho"), for file names and keys. */
  slug: pick("VITE_TENANT_SLUG", "el-rancho"),
  /** Brand name shown in titles, alt texts and page metadata. */
  name: pick("VITE_TENANT_NAME", "Óptica El Rancho"),
  /** Single-word form for tight spots. */
  compactName: pick("VITE_TENANT_COMPACT_NAME", "EL RANCHO"),
  /** Storefront host ("www.example.com"), for copy that names the site. */
  site: pick("VITE_TENANT_SITE", ""),
  /** The panel's public address ("https://opticaelrancho.com/admin"): where «Salir» lands. */
  adminUrl: pick("VITE_TENANT_ADMIN_URL", ""),
  /** Tagline appended to the brand in document titles. */
  tagline: pick("VITE_TENANT_TAGLINE", "Óptica y Salud Visual"),
  /** Logos: the one the owner uploaded in the panel (brandRuntime.js) or the build's (/public). */
  get logo() {
    return runtimeLogo("full") || BUILD_LOGO;
  },
  get logoMark() {
    return runtimeLogo("mark") || BUILD_LOGO_MARK;
  },
  /** Supplier credit shown in the footer; empty hides it. */
  imageCredit: pick("VITE_TENANT_IMAGE_CREDIT", "caprioptics.com"),
});

/** `"DC407 · Di Caprio | <brand>"` — the document-title convention. */
export const pageTitle = (text) => `${text} | ${TENANT.name}`;
