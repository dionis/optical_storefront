/** Per-locale display overrides for translated catalog content. English lives in the canonical `title`/`description` fields. */
export interface FrameTranslations {
    es?: {
        title: string;
        description: string;
    };
    fr?: {
        title: string;
        description: string;
    };
}
/** Shape of a document indexed in Meilisearch index "frames" */
export interface MeilisearchFrameDocument {
    id: string;
    title: string;
    description: string;
    handle: string;
    collection: string;
    shape: string;
    material: string;
    gender: string;
    age_group: string;
    colors: string[];
    eye_size: number;
    bridge_size: number;
    temple_length: number;
    /** Lowest variant price in cents */
    price_from: number;
    /** Pre-discount "compare at" price in cents, if any; null when not on sale */
    original_price_from: number | null;
    features: string[];
    thumbnail: string;
    /** 1-5, one decimal precision */
    rating: number;
    review_count: number;
    best_seller: boolean;
    i18n: FrameTranslations;
}
//# sourceMappingURL=search.d.ts.map