/**
 * Tenant identity — the ONE place the backend learns which store it is.
 *
 * Multi-tenant model (docs/MULTI-TENANT-TECNICO.md): one deployment per store
 * (its own Coolify app, database, Stripe account, Google Sheet and Vercel
 * project), all built from this same repository. What differs between stores
 * is configuration, and this module is the schema for that configuration, so
 * cloning the stack for a second optician is "fill the TENANT_* / STORE_*
 * variables", never "search the code for a brand name".
 *
 * Two layers, read in this order:
 *   1. what the owner saved in the panel (`tenant_profile`, src/lib/tenant-profile.ts),
 *      held here in memory so `tenant()` stays synchronous for its many callers;
 *   2. the deployment's variables, each with today's RUBI LENS default, so a
 *      deployment without the new variables behaves exactly as before.
 */
import { storefrontOrigin } from "./order-access";
import { normalizeOrigin } from "./storefront-origin";

export interface TenantBrand {
  /** Header and button colour of the emails. */
  emailPrimary: string;
  /** Accent (rules, badges) of the emails. */
  emailAccent: string;
}

export interface Tenant {
  /** Short brand name as shown in emails, SMS and the sheet. */
  name: string;
  /** Legal/registered name for invoices and legal pages. */
  legalName: string;
  /** Public storefront origin (https://www.example.com). */
  storefrontUrl: string;
  /** Support address shown to customers. */
  supportEmail: string | null;
  /** IANA timezone used for the sheet and date formatting. */
  timezone: string;
  /** Default notification locale ("es" | "en"). */
  locale: string;
  /** ISO-4217 currency of the region the store sells in. */
  currency: string;
  /** ISO-3166 alpha-2 country the store ships within. */
  country: string;
  /** Prefix for SMS texts (defaults to `name`). */
  smsPrefix: string;
  brand: TenantBrand;
}

/** The part of `tenant_profile` that overrides the deployment's variables. */
export interface TenantOverlay {
  display_name?: string | null;
  legal_name?: string | null;
  /** Brand saved from the panel (src/lib/tenant-brand.ts); null = the deployment's colours. */
  brand?: { primary: string; accent: string; logo_url: string | null } | null;
}

export const DEFAULT_EMAIL_BRAND: Readonly<TenantBrand> = Object.freeze({ emailPrimary: "#0b2f66", emailAccent: "#b8921e" });

const str = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
};

const hex = (name: string, fallback: string): string => {
  const v = str(name, fallback);
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
};

const filled = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/**
 * The brand of one storefront domain served by this backend (`STOREFRONT_BRANDS`).
 *
 * One backend can run two businesses' faces: the physical stores and their
 * panel (the deployment's own brand) and a web shop on another domain with its
 * own name (docs/TIENDA-ONLINE-UNIFICADA.md). An order bought on that domain
 * carries it in `metadata.storefront_origin`, its emails and SMS run inside
 * `withStorefrontOrigin`, and there `tenant()` answers with this brand instead
 * of the deployment's. Anything outside such a scope (the till, receipts,
 * staff emails, the sheet) keeps the deployment's brand.
 */
export interface StorefrontBrand {
  /** Normalized origin (`https://www.example.com`). */
  origin: string;
  name: string;
  /** Email colours; null = the deployment's. */
  primary: string | null;
  accent: string | null;
  /** Absolute logo URL for emails; null = `<origin>/logo-oficial.png`. */
  logoUrl: string | null;
  /** Sender of its emails (`Name <address>`), on a domain verified in Resend; null = RESEND_FROM_EMAIL. */
  from: string | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Parses `STOREFRONT_BRANDS`: entries separated by `;`, fields by `|`:
 *
 *   origin | name | primary | accent | logo URL | from
 *
 * Only origin and name are required; an empty field keeps the default. An
 * entry with a bad origin or no name is dropped (reported by `problems`), never
 * half applied. Pure.
 */
export function parseStorefrontBrands(raw: string | undefined | null): { brands: StorefrontBrand[]; problems: string[] } {
  const brands: StorefrontBrand[] = [];
  const problems: string[] = [];
  for (const entry of String(raw ?? "").split(";")) {
    if (!entry.trim()) continue;
    const [o, n, primary, accent, logo, from] = entry.split("|").map((f) => f.trim());
    const origin = normalizeOrigin(o);
    if (!origin) { problems.push(`bad_origin:${o ?? ""}`); continue; }
    if (!n) { problems.push(`no_name:${origin}`); continue; }
    if (brands.some((b) => b.origin === origin)) { problems.push(`duplicate:${origin}`); continue; }
    for (const [label, value] of [["primary", primary], ["accent", accent]] as const) if (value && !HEX.test(value)) problems.push(`bad_${label}:${origin}`);
    if (logo && !/^https:\/\//i.test(logo)) problems.push(`bad_logo:${origin}`);
    brands.push({
      origin,
      name: n,
      primary: primary && HEX.test(primary) ? primary.toLowerCase() : null,
      accent: accent && HEX.test(accent) ? accent.toLowerCase() : null,
      logoUrl: logo && /^https:\/\//i.test(logo) ? logo : null,
      from: from || null,
    });
  }
  return { brands, problems };
}

let brandsRaw: string | undefined;
let brandsParsed: StorefrontBrand[] = [];

/** Every storefront brand of this deployment (re-parsed only when the variable changes). */
export function storefrontBrands(): StorefrontBrand[] {
  const raw = process.env.STOREFRONT_BRANDS;
  if (raw !== brandsRaw) {
    brandsRaw = raw;
    brandsParsed = parseStorefrontBrands(raw).brands;
  }
  return brandsParsed;
}

/** The brand of the storefront the current piece of work belongs to, or null (the deployment's own). */
export function storefrontBrand(): StorefrontBrand | null {
  const list = storefrontBrands();
  if (!list.length) return null;
  const origin = normalizeOrigin(storefrontOrigin());
  return (origin && list.find((b) => b.origin === origin)) || null;
}

/** The brand name of an origin (a web order's `storefront_origin`), or null when it is the deployment's. */
export function storefrontBrandName(origin: unknown): string | null {
  const o = normalizeOrigin(origin);
  return (o && storefrontBrands().find((b) => b.origin === o)?.name) || null;
}

let overlay: TenantOverlay = {};

/** Replaces the owner-edited layer (called by src/lib/tenant-profile.ts after a read or a save). */
export function setTenantOverlay(next: TenantOverlay): void {
  overlay = { ...next };
}

export function tenant(): Tenant {
  const envName = str("STORE_NAME", "RUBI LENS");
  const own = filled(overlay.display_name) ?? envName;
  // Inside the scope of another storefront of this backend, that shop's brand.
  const web = storefrontBrand();
  const name = web?.name ?? own;
  return {
    name,
    legalName: web ? web.name : filled(overlay.legal_name) ?? str("TENANT_LEGAL_NAME", own),
    storefrontUrl: storefrontOrigin(),
    supportEmail: process.env.STORE_SUPPORT_EMAIL?.trim() || process.env.STORE_ORDER_NOTIFICATION_EMAIL?.trim() || null,
    timezone: str("GSHEET_TIMEZONE", "America/Chicago"),
    locale: str("STORE_NOTIFICATION_LOCALE", "es"),
    currency: str("TENANT_CURRENCY", "usd").toLowerCase(),
    country: str("TENANT_COUNTRY", "us").toLowerCase(),
    smsPrefix: web ? web.name : str("TENANT_SMS_PREFIX", name),
    brand: {
      emailPrimary: web?.primary ?? hex("TENANT_BRAND_PRIMARY", DEFAULT_EMAIL_BRAND.emailPrimary),
      emailAccent: web?.accent ?? hex("TENANT_BRAND_ACCENT", DEFAULT_EMAIL_BRAND.emailAccent),
    },
  };
}

/** The brand the owner saved in the panel, or null while it is the deployment's. */
export function ownerBrand(): { primary: string; accent: string; logo_url: string | null } | null {
  // Another storefront of this backend has its own brand: the one the owner
  // saved in the panel belongs to the deployment's stores, not to that shop.
  const web = storefrontBrand();
  if (web) {
    return {
      primary: web.primary ?? hex("TENANT_BRAND_PRIMARY", DEFAULT_EMAIL_BRAND.emailPrimary),
      accent: web.accent ?? hex("TENANT_BRAND_ACCENT", DEFAULT_EMAIL_BRAND.emailAccent),
      logo_url: web.logoUrl ?? `${web.origin}/logo-oficial.png`,
    };
  }
  return overlay.brand ?? null;
}

/** Brand name alone — the common case. */
export function tenantName(): string {
  return tenant().name;
}

/** Host of the storefront ("www.example.com"), for ids that must name the store. */
export function tenantHost(): string {
  try {
    return new URL(tenant().storefrontUrl).host || "store";
  } catch {
    return "store";
  }
}
