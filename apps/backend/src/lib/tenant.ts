/**
 * Tenant identity — the ONE place the backend learns which store it is.
 *
 * Multi-tenant model (see docs/MULTI-TENANT.md): one deployment per store
 * (its own Coolify app, database, Stripe account, Google Sheet and Vercel
 * project), all built from this same repository. What differs between stores
 * is configuration, and this module is the schema for that configuration, so
 * cloning the stack for a second optician is "fill the TENANT_* / STORE_*
 * variables", never "search the code for RUBI LENS".
 *
 * Every value has today's RUBI LENS default, so a deployment without the new
 * variables behaves exactly as before.
 */
import { storefrontOrigin } from "./order-access";

export interface Tenant {
  /** Short brand name as shown in emails, SMS and the sheet ("RUBI LENS"). */
  name: string;
  /** Legal/registered name for invoices and legal pages. */
  legalName: string;
  /** Public storefront origin (https://www.rubilens.com). */
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
}

const str = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
};

export function tenant(): Tenant {
  const name = str("STORE_NAME", "RUBI LENS");
  return {
    name,
    legalName: str("TENANT_LEGAL_NAME", name),
    storefrontUrl: storefrontOrigin(),
    supportEmail: process.env.STORE_SUPPORT_EMAIL?.trim() || process.env.STORE_ORDER_NOTIFICATION_EMAIL?.trim() || null,
    timezone: str("GSHEET_TIMEZONE", "America/Chicago"),
    locale: str("STORE_NOTIFICATION_LOCALE", "es"),
    currency: str("TENANT_CURRENCY", "usd").toLowerCase(),
    country: str("TENANT_COUNTRY", "us").toLowerCase(),
    smsPrefix: str("TENANT_SMS_PREFIX", name),
  };
}

/** Brand name alone — the common case. */
export function tenantName(): string {
  return tenant().name;
}
