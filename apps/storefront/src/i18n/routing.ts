import { defineRouting } from "next-intl/routing";

export const locales = ["es", "en", "fr"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "es";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
});
