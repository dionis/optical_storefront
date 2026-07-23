import type { FrameTranslations, MeilisearchFrameDocument } from "./search";

export type Locale = "es" | "en" | "fr";

export interface LocalizedFrameText {
  title: string;
  description: string;
}

/** Resolves display title/description for a Meilisearch-backed listing card, falling back to English. */
export function resolveLocalizedFrameText(
  doc: Pick<MeilisearchFrameDocument, "title" | "description" | "i18n">,
  locale: Locale
): LocalizedFrameText {
  if (locale === "en") {
    return { title: doc.title, description: doc.description };
  }
  const translation = doc.i18n[locale];
  return {
    title: translation?.title || doc.title,
    description: translation?.description || doc.description,
  };
}

/** Resolves display title/description for a Store-API-backed PDP, reading the same `i18n` metadata bag directly. */
export function resolveLocalizedProductMetadataText(
  metadata: Record<string, unknown> | null | undefined,
  fallbackTitle: string,
  fallbackDescription: string,
  locale: Locale
): LocalizedFrameText {
  if (locale === "en") {
    return { title: fallbackTitle, description: fallbackDescription };
  }
  const i18n = (metadata?.["i18n"] as FrameTranslations | undefined) ?? {};
  const translation = i18n[locale];
  return {
    title: translation?.title || fallbackTitle,
    description: translation?.description || fallbackDescription,
  };
}
