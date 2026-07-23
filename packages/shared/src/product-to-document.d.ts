import type { MeilisearchFrameDocument } from "./search";
/** Permissive shape covering both the subscriber's `retrieveProduct()` result and the Admin SDK's `product.list()` result. */
export interface MedusaProductLike {
    id: string;
    title: string;
    handle: string;
    description?: string | null;
    thumbnail?: string | null;
    metadata?: Record<string, unknown> | null;
    variants?: Array<{
        title?: string | null;
        prices?: Array<{
            amount: number;
            currency_code?: string;
        }>;
    }> | null;
    images?: Array<{
        url: string;
    }> | null;
}
/**
 * Maps a Medusa product (with frame metadata) to a Meilisearch document.
 * Product metadata is stored under product.metadata per Medusa convention.
 */
export declare function productToDocument(product: MedusaProductLike): MeilisearchFrameDocument;
//# sourceMappingURL=product-to-document.d.ts.map