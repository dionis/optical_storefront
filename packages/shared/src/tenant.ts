/**
 * Tenant manifest — `tenants/<slug>/tenant.json`, the one file that says which
 * optician a deployment is (docs/MULTI-TENANT-TECNICO.md §6).
 *
 * It feeds the build-time layer (storefront and try-on `VITE_TENANT_*`) and the
 * deploy-time layer (backend `STORE_NAME`, `TENANT_*`). What the owner edits after
 * hand-over lives in the backend's `tenant_profile` table, not here.
 *
 * Pure: no I/O, so the CLI, the build and the tests share the same rules.
 */

export type TenantLanguage = "es" | "en" | "fr";
export const TENANT_LANGUAGES: readonly TenantLanguage[] = ["es", "en", "fr"];

/** A text in every language the store shows. */
export type LocalizedText = Partial<Record<TenantLanguage, string>>;

export interface TenantManifest {
  slug: string;
  identity: {
    /** Brand as shown in titles, emails and SMS ("RUBI LENS"). */
    name: string;
    /** Single-word form for tight spots (the try-on header: "RUBILENS"). */
    compactName?: string;
    legalName?: string;
    tagline: LocalizedText;
  };
  seo: {
    /** `<title>` of the home page. */
    title: LocalizedText;
    description: LocalizedText;
    /** Open Graph / Twitter title and description. */
    socialTitle: LocalizedText;
    socialDescription: LocalizedText;
    /** Description in the installable-app manifest; defaults to socialDescription. */
    appDescription?: LocalizedText;
  };
  domains: {
    storefront: string;
    api?: string;
    emailFrom?: string;
  };
  locale: {
    default: TenantLanguage;
    languages: TenantLanguage[];
    timezone: string;
    currency: string;
    country: string;
  };
  brand: {
    /** Storefront palette. */
    primary: string;
    primaryDark: string;
    accent: string;
    /** Browser chrome / PWA colour. */
    themeColor: string;
    /** Email palette (emails were designed on a slightly different navy). */
    emailPrimary: string;
    emailAccent: string;
    logo: string;
    logoMark: string;
  };
  supplier: {
    id: string;
    /** Footer credit for the product photos; empty hides it. */
    imageCredit: string;
  };
  owner?: {
    email: string;
    name?: string;
  };
}

// This package builds against the ES library only (no DOM, no Node types), but
// URL exists in every runtime that loads it: browsers, Node and the test runner.
declare const URL: new (input: string) => { protocol: string; hostname: string; pathname: string };

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return (u.protocol === "https:" || (local && u.protocol === "http:")) && (u.pathname === "/" || u.pathname === "");
  } catch {
    return false;
  }
}

function isTimezone(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every problem in a manifest, as `path: message` lines. Empty = valid.
 * Messages are for the operator running `pnpm tenant validate`, so plain English.
 */
export function validateTenantManifest(input: unknown): string[] {
  const errors: string[] = [];
  const m = (input ?? {}) as Partial<TenantManifest>;
  const need = (ok: boolean, path: string, msg: string) => {
    if (!ok) errors.push(`${path}: ${msg}`);
  };
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;

  need(typeof m.slug === "string" && SLUG.test(m.slug), "slug", "lowercase letters, digits and dashes (max 40)");

  const languages = Array.isArray(m.locale?.languages) ? m.locale!.languages : [];
  need(languages.length > 0 && languages.every((l) => TENANT_LANGUAGES.includes(l)), "locale.languages", `subset of ${TENANT_LANGUAGES.join(", ")}`);
  need(languages.includes(m.locale?.default as TenantLanguage), "locale.default", "must be one of locale.languages");
  need(isTimezone(m.locale?.timezone), "locale.timezone", "IANA time zone (America/Chicago)");
  need(/^[a-z]{3}$/.test(String(m.locale?.currency ?? "")), "locale.currency", "ISO-4217, lowercase (usd)");
  need(/^[a-z]{2}$/.test(String(m.locale?.country ?? "")), "locale.country", "ISO-3166 alpha-2, lowercase (us)");

  const localized = (v: unknown, path: string) => {
    for (const lang of languages) need(text((v as LocalizedText | undefined)?.[lang]), `${path}.${lang}`, "missing text");
  };

  need(text(m.identity?.name), "identity.name", "required");
  localized(m.identity?.tagline, "identity.tagline");
  localized(m.seo?.title, "seo.title");
  localized(m.seo?.description, "seo.description");
  localized(m.seo?.socialTitle, "seo.socialTitle");
  localized(m.seo?.socialDescription, "seo.socialDescription");

  need(isOrigin(m.domains?.storefront), "domains.storefront", "https origin without a path");
  if (m.domains?.api !== undefined) need(isOrigin(m.domains.api), "domains.api", "https origin without a path");
  if (m.domains?.emailFrom !== undefined) need(EMAIL.test(m.domains.emailFrom), "domains.emailFrom", "email address");

  const colors = ["primary", "primaryDark", "accent", "themeColor", "emailPrimary", "emailAccent"] as const;
  for (const c of colors) need(HEX.test(String(m.brand?.[c] ?? "")), `brand.${c}`, "#rrggbb");
  for (const c of ["primary", "emailPrimary"] as const) {
    const v = String(m.brand?.[c] ?? "");
    if (HEX.test(v)) {
      const ratio = contrastRatio(v, "#ffffff");
      need(ratio >= 4.5, `brand.${c}`, `white text on it has contrast ${ratio.toFixed(2)}:1, needs 4.5:1`);
    }
  }
  need(text(m.brand?.logo) && String(m.brand?.logo).startsWith("/"), "brand.logo", "path under the storefront's public folder (/logo.png)");
  need(text(m.brand?.logoMark) && String(m.brand?.logoMark).startsWith("/"), "brand.logoMark", "path under the storefront's public folder");

  need(text(m.supplier?.id), "supplier.id", "required");
  need(typeof m.supplier?.imageCredit === "string", "supplier.imageCredit", "string (empty hides the credit)");

  if (m.owner !== undefined) need(EMAIL.test(String(m.owner.email ?? "")), "owner.email", "email address");

  return errors;
}

/** Localized text in `lang`, else the default language, else any. */
export function pickText(v: LocalizedText | undefined, lang: TenantLanguage, fallback: TenantLanguage): string {
  return v?.[lang] ?? v?.[fallback] ?? Object.values(v ?? {})[0] ?? "";
}
