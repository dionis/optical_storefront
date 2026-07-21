/**
 * Reindex all products from Medusa into Meilisearch.
 * Run with: pnpm --filter backend reindex
 * Idempotent — safe to re-run at any time.
 */

import "dotenv/config";
import { MeiliSearch } from "meilisearch";
import Medusa from "@medusajs/js-sdk";

const INDEX_NAME = "frames";

const FILTERABLE_ATTRIBUTES = [
  "shape",
  "material",
  "gender",
  "age_group",
  "colors",
  "collection",
  "features",
  "eye_size",
];

const SORTABLE_ATTRIBUTES = ["price_from", "title"];

const SEARCHABLE_ATTRIBUTES = ["title", "collection", "shape", "material"];

async function reindex(): Promise<void> {
  const meiliHost = process.env.MEILISEARCH_HOST ?? "http://localhost:7700";
  const meiliKey = process.env.MEILISEARCH_MASTER_KEY;
  const medusaUrl = process.env.BACKEND_URL ?? "http://localhost:9000";
  const medusaApiKey = process.env.MEDUSA_ADMIN_API_KEY;

  if (!medusaApiKey) {
    throw new Error("MEDUSA_ADMIN_API_KEY env variable is required for reindex.");
  }

  const meili = new MeiliSearch({ host: meiliHost, apiKey: meiliKey });

  // Configure index settings
  const index = meili.index(INDEX_NAME);
  await index.updateSettings({
    filterableAttributes: FILTERABLE_ATTRIBUTES,
    sortableAttributes: SORTABLE_ATTRIBUTES,
    searchableAttributes: SEARCHABLE_ATTRIBUTES,
  });

  console.log(`[reindex] Meilisearch index '${INDEX_NAME}' settings updated.`);

  // Fetch all products from Medusa Admin API with pagination
  const sdk = new Medusa({ baseUrl: medusaUrl, apiKey: medusaApiKey });

  let offset = 0;
  const limit = 100;
  let total = Infinity;
  let processed = 0;

  while (offset < total) {
    const { products, count } = await sdk.admin.product.list({
      limit,
      offset,
      expand: "variants,variants.prices,images,collection",
    });

    total = count;

    if (products.length === 0) break;

    const docs = products.map((product) => {
      const meta = (product.metadata ?? {}) as Record<string, unknown>;
      const variants = (product.variants ?? []) as Array<Record<string, unknown>>;
      const colors = variants.map((v) => String(v["title"] ?? "")).filter(Boolean);
      const prices = variants
        .flatMap((v) => (v["prices"] ?? []) as Array<Record<string, unknown>>)
        .map((p) => Number(p["amount"]))
        .filter((a) => !isNaN(a));

      return {
        id: product.id,
        title: product.title ?? "",
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
        price_from: prices.length > 0 ? Math.min(...prices) : 0,
        features: (meta["features"] as string[]) ?? [],
        thumbnail:
          product.thumbnail ??
          (product.images?.[0] as { url?: string } | undefined)?.url ??
          "",
      };
    });

    await index.addDocuments(docs);
    processed += docs.length;
    offset += limit;

    console.log(`[reindex] Indexed ${processed}/${total} products…`);
  }

  console.log(`[reindex] Done. ${processed} products indexed into '${INDEX_NAME}'.`);
}

reindex().catch((err: unknown) => {
  console.error("[reindex] Failed:", err);
  process.exit(1);
});
