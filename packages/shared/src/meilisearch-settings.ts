/** Single source of truth for the Meilisearch "frames" index shape, shared by backend index setup, reindex, and the storefront query client. */

export const FRAMES_INDEX_NAME = "frames";

export const FRAMES_FILTERABLE_ATTRIBUTES = [
  "shape",
  "material",
  "gender",
  "age_group",
  "colors",
  "collection",
  "features",
  "eye_size",
  "best_seller",
];

export const FRAMES_SORTABLE_ATTRIBUTES = [
  "price_from",
  "title",
  "rating",
  "best_seller",
];

export const FRAMES_SEARCHABLE_ATTRIBUTES = [
  "title",
  "description",
  "collection",
  "shape",
  "material",
];

export const FRAMES_DISPLAYED_ATTRIBUTES = [
  "id",
  "title",
  "description",
  "handle",
  "collection",
  "shape",
  "material",
  "gender",
  "age_group",
  "colors",
  "eye_size",
  "bridge_size",
  "temple_length",
  "price_from",
  "original_price_from",
  "features",
  "thumbnail",
  "rating",
  "review_count",
  "best_seller",
  "i18n",
];
