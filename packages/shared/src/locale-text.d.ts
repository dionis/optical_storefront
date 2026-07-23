import type { MeilisearchFrameDocument } from "./search";
export type Locale = "es" | "en" | "fr";
export interface LocalizedFrameText {
    title: string;
    description: string;
}
/** Resolves display title/description for a Meilisearch-backed listing card, falling back to English. */
export declare function resolveLocalizedFrameText(doc: Pick<MeilisearchFrameDocument, "title" | "description" | "i18n">, locale: Locale): LocalizedFrameText;
/** Resolves display title/description for a Store-API-backed PDP, reading the same `i18n` metadata bag directly. */
export declare function resolveLocalizedProductMetadataText(metadata: Record<string, unknown> | null | undefined, fallbackTitle: string, fallbackDescription: string, locale: Locale): LocalizedFrameText;
//# sourceMappingURL=locale-text.d.ts.map