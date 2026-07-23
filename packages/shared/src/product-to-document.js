"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productToDocument = productToDocument;
/**
 * Maps a Medusa product (with frame metadata) to a Meilisearch document.
 * Product metadata is stored under product.metadata per Medusa convention.
 */
function productToDocument(product) {
    const meta = product.metadata ?? {};
    const variants = product.variants ?? [];
    const colors = variants
        .map((v) => v.title ?? "")
        .filter((title) => title.length > 0);
    const prices = variants
        .flatMap((v) => v.prices ?? [])
        .map((p) => p.amount)
        .filter((amount) => typeof amount === "number" && !isNaN(amount));
    const price_from = prices.length > 0 ? Math.min(...prices) : 0;
    const thumbnail = product.thumbnail ?? product.images?.[0]?.url ?? "";
    return {
        id: product.id,
        title: product.title ?? "",
        description: product.description ?? "",
        handle: product.handle ?? "",
        collection: String(meta["collection_slug"] ?? ""),
        shape: String(meta["shape"] ?? ""),
        material: String(meta["material"] ?? ""),
        gender: String(meta["gender"] ?? ""),
        age_group: String(meta["age_group"] ?? ""),
        colors,
        eye_size: Number(meta["eye_size"] ?? 0),
        bridge_size: Number(meta["bridge_size"] ?? 0),
        temple_length: Number(meta["temple_length"] ?? 0),
        price_from,
        original_price_from: typeof meta["original_price_cents"] === "number" ? meta["original_price_cents"] : null,
        features: meta["features"] ?? [],
        thumbnail,
        rating: typeof meta["rating"] === "number" ? meta["rating"] : 0,
        review_count: typeof meta["review_count"] === "number" ? meta["review_count"] : 0,
        best_seller: meta["best_seller"] === true,
        i18n: meta["i18n"] ?? {},
    };
}
//# sourceMappingURL=product-to-document.js.map