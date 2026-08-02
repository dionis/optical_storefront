import { MedusaContainer } from "@medusajs/framework/types";
import { STORE_SETTINGS_MODULE } from "../modules/store-settings/index";
import type StoreSettingsModuleService from "../modules/store-settings/service";

/** The single settings row. */
export const STORE_SETTING_ID = "default";

/**
 * Payment providers the owner may pick from. Each must also be registered (with
 * its credentials) in medusa-config; this list only guards what the admin route
 * accepts, so a typo can't point the storefront at a provider that isn't wired.
 */
export const KNOWN_PAYMENT_PROVIDERS = [
  "pp_stripe_stripe",
  "pp_paypal_paypal",
  "pp_square_square",
] as const;

export type PaymentProviderId = (typeof KNOWN_PAYMENT_PROVIDERS)[number];

export interface StoreSettings {
  owner_notification_email: string | null;
  owner_notification_sms: string | null;
  active_payment_provider: string;
  /** Frame-only sales-tax rate as a decimal in [0, 1] (0 = no frame tax). */
  frame_tax_rate: number;
  source: "database" | "env";
  updated_by?: string | null;
  updated_at?: string | null;
}

/** Parse a tax rate ("0.07", "7%" → 0.07) and clamp to [0, 1]; invalid → 0. */
export function parseTaxRate(value: unknown): number {
  if (value == null) return 0;
  let s = String(value).trim();
  if (!s) return 0;
  let pct = false;
  if (s.endsWith("%")) {
    pct = true;
    s = s.slice(0, -1).trim();
  }
  let n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (pct) n = n / 100;
  // A value like "7" almost certainly means 7%, not 700% — treat >1 as percent.
  if (n > 1) n = n / 100;
  return Math.min(Math.max(n, 0), 1);
}

export function isKnownPaymentProvider(value: unknown): value is PaymentProviderId {
  return (
    typeof value === "string" &&
    (KNOWN_PAYMENT_PROVIDERS as readonly string[]).includes(value)
  );
}

/** Values used until an admin saves a row — matches today's env-only behaviour. */
function envDefaults(): StoreSettings {
  const envProvider = process.env.DEFAULT_PAYMENT_PROVIDER;
  return {
    owner_notification_email:
      process.env.STORE_ORDER_NOTIFICATION_EMAIL ??
      process.env.RESEND_FROM_EMAIL ??
      null,
    owner_notification_sms: process.env.STORE_ORDER_NOTIFICATION_SMS ?? null,
    active_payment_provider: isKnownPaymentProvider(envProvider)
      ? envProvider
      : "pp_stripe_stripe",
    frame_tax_rate: parseTaxRate(process.env.STORE_FRAME_TAX_RATE),
    source: "env",
  };
}

/**
 * Resolve the effective store settings: the saved row when present and valid,
 * otherwise the environment defaults. Wrapped so a missing module or an
 * un-migrated table can never take a request down — env wins, exactly like
 * resolveOcrSettings.
 */
export async function resolveStoreSettings(
  container: MedusaContainer
): Promise<StoreSettings> {
  const defaults = envDefaults();

  let rows: Record<string, unknown>[] = [];
  try {
    const svc = container.resolve<StoreSettingsModuleService>(STORE_SETTINGS_MODULE);
    rows = (await svc.listStoreSettings({ id: STORE_SETTING_ID })) as unknown as Record<
      string,
      unknown
    >[];
  } catch {
    return defaults;
  }

  const row = rows[0];
  if (!row) return defaults;

  const storedProvider = row["active_payment_provider"];

  return {
    owner_notification_email:
      (row["owner_notification_email"] as string | null) ??
      defaults.owner_notification_email,
    owner_notification_sms:
      (row["owner_notification_sms"] as string | null) ??
      defaults.owner_notification_sms,
    active_payment_provider: isKnownPaymentProvider(storedProvider)
      ? storedProvider
      : defaults.active_payment_provider,
    frame_tax_rate:
      row["frame_tax_rate"] != null
        ? parseTaxRate(row["frame_tax_rate"])
        : defaults.frame_tax_rate,
    source: "database",
    updated_by: (row["updated_by"] as string | null) ?? null,
    updated_at: (row["updated_at"] as string | null) ?? null,
  };
}
