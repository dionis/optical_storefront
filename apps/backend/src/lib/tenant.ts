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

let overlay: TenantOverlay = {};

/** Replaces the owner-edited layer (called by src/lib/tenant-profile.ts after a read or a save). */
export function setTenantOverlay(next: TenantOverlay): void {
  overlay = { ...next };
}

export function tenant(): Tenant {
  const envName = str("STORE_NAME", "RUBI LENS");
  const name = filled(overlay.display_name) ?? envName;
  return {
    name,
    legalName: filled(overlay.legal_name) ?? str("TENANT_LEGAL_NAME", name),
    storefrontUrl: storefrontOrigin(),
    supportEmail: process.env.STORE_SUPPORT_EMAIL?.trim() || process.env.STORE_ORDER_NOTIFICATION_EMAIL?.trim() || null,
    timezone: str("GSHEET_TIMEZONE", "America/Chicago"),
    locale: str("STORE_NOTIFICATION_LOCALE", "es"),
    currency: str("TENANT_CURRENCY", "usd").toLowerCase(),
    country: str("TENANT_COUNTRY", "us").toLowerCase(),
    smsPrefix: str("TENANT_SMS_PREFIX", name),
    brand: {
      emailPrimary: hex("TENANT_BRAND_PRIMARY", DEFAULT_EMAIL_BRAND.emailPrimary),
      emailAccent: hex("TENANT_BRAND_ACCENT", DEFAULT_EMAIL_BRAND.emailAccent),
    },
  };
}

/** The brand the owner saved in the panel, or null while it is the deployment's. */
export function ownerBrand(): { primary: string; accent: string; logo_url: string | null } | null {
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
