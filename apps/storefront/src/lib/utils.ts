import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Locale } from "@/i18n/routing";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Currency is always USD (backend is USD-only) — only digit-grouping/symbol placement changes by locale. */
const LOCALE_TO_INTL: Record<Locale, string> = {
  es: "es-MX",
  en: "en-US",
  fr: "fr-FR",
};

/** Format a price in cents to a locale string, e.g. 9900 → "$99.00" */
export function formatPrice(
  cents: number,
  locale: Locale = "es",
  currency = "USD"
): string {
  return new Intl.NumberFormat(LOCALE_TO_INTL[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
