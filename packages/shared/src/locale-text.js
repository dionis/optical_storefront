"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLocalizedFrameText = resolveLocalizedFrameText;
exports.resolveLocalizedProductMetadataText = resolveLocalizedProductMetadataText;
/** Resolves display title/description for a Meilisearch-backed listing card, falling back to English. */
function resolveLocalizedFrameText(doc, locale) {
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
function resolveLocalizedProductMetadataText(metadata, fallbackTitle, fallbackDescription, locale) {
    if (locale === "en") {
        return { title: fallbackTitle, description: fallbackDescription };
    }
    const i18n = metadata?.["i18n"] ?? {};
    const translation = i18n[locale];
    return {
        title: translation?.title || fallbackTitle,
        description: translation?.description || fallbackDescription,
    };
}
//# sourceMappingURL=locale-text.js.map