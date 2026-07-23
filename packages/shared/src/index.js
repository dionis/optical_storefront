"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLocalizedProductMetadataText = exports.resolveLocalizedFrameText = exports.productToDocument = exports.FRAMES_DISPLAYED_ATTRIBUTES = exports.FRAMES_SEARCHABLE_ATTRIBUTES = exports.FRAMES_SORTABLE_ATTRIBUTES = exports.FRAMES_FILTERABLE_ATTRIBUTES = exports.FRAMES_INDEX_NAME = void 0;
var meilisearch_settings_1 = require("./meilisearch-settings");
Object.defineProperty(exports, "FRAMES_INDEX_NAME", { enumerable: true, get: function () { return meilisearch_settings_1.FRAMES_INDEX_NAME; } });
Object.defineProperty(exports, "FRAMES_FILTERABLE_ATTRIBUTES", { enumerable: true, get: function () { return meilisearch_settings_1.FRAMES_FILTERABLE_ATTRIBUTES; } });
Object.defineProperty(exports, "FRAMES_SORTABLE_ATTRIBUTES", { enumerable: true, get: function () { return meilisearch_settings_1.FRAMES_SORTABLE_ATTRIBUTES; } });
Object.defineProperty(exports, "FRAMES_SEARCHABLE_ATTRIBUTES", { enumerable: true, get: function () { return meilisearch_settings_1.FRAMES_SEARCHABLE_ATTRIBUTES; } });
Object.defineProperty(exports, "FRAMES_DISPLAYED_ATTRIBUTES", { enumerable: true, get: function () { return meilisearch_settings_1.FRAMES_DISPLAYED_ATTRIBUTES; } });
var product_to_document_1 = require("./product-to-document");
Object.defineProperty(exports, "productToDocument", { enumerable: true, get: function () { return product_to_document_1.productToDocument; } });
var locale_text_1 = require("./locale-text");
Object.defineProperty(exports, "resolveLocalizedFrameText", { enumerable: true, get: function () { return locale_text_1.resolveLocalizedFrameText; } });
Object.defineProperty(exports, "resolveLocalizedProductMetadataText", { enumerable: true, get: function () { return locale_text_1.resolveLocalizedProductMetadataText; } });
//# sourceMappingURL=index.js.map