"use strict";
/** Single source of truth for the Meilisearch "frames" index shape, shared by backend index setup, reindex, and the storefront query client. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAMES_DISPLAYED_ATTRIBUTES = exports.FRAMES_SEARCHABLE_ATTRIBUTES = exports.FRAMES_SORTABLE_ATTRIBUTES = exports.FRAMES_FILTERABLE_ATTRIBUTES = exports.FRAMES_INDEX_NAME = void 0;
exports.FRAMES_INDEX_NAME = "frames";
exports.FRAMES_FILTERABLE_ATTRIBUTES = [
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
exports.FRAMES_SORTABLE_ATTRIBUTES = [
    "price_from",
    "title",
    "rating",
    "best_seller",
];
exports.FRAMES_SEARCHABLE_ATTRIBUTES = [
    "title",
    "description",
    "collection",
    "shape",
    "material",
];
exports.FRAMES_DISPLAYED_ATTRIBUTES = [
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
//# sourceMappingURL=meilisearch-settings.js.map