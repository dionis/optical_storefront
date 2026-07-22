export type { Prescription, PrescriptionEye, PrescriptionSource, PrescriptionValidationResult } from "./prescription.js";
export type { LensConfig, UsageType, LensIndex, CoatingType, CartLensMetadata } from "./lens-config.js";
export type { FrameAttributes, FrameSize, FrameShape, FrameMaterial } from "./frame-attributes.js";
export type { MeilisearchFrameDocument, FrameTranslations } from "./search.js";
export {
  FRAMES_INDEX_NAME,
  FRAMES_FILTERABLE_ATTRIBUTES,
  FRAMES_SORTABLE_ATTRIBUTES,
  FRAMES_SEARCHABLE_ATTRIBUTES,
  FRAMES_DISPLAYED_ATTRIBUTES,
} from "./meilisearch-settings.js";
export { productToDocument } from "./product-to-document.js";
export type { MedusaProductLike } from "./product-to-document.js";
export type { Locale, LocalizedFrameText } from "./locale-text.js";
export { resolveLocalizedFrameText, resolveLocalizedProductMetadataText } from "./locale-text.js";
