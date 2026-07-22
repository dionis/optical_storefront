/**
 * Reindex all products from Medusa into Meilisearch.
 * Run with: pnpm --filter backend reindex
 * Idempotent — safe to re-run at any time.
 */

import "dotenv/config";
import { MeiliSearch } from "meilisearch";
import Medusa from "@medusajs/js-sdk";
import {
  FRAMES_INDEX_NAME,
  FRAMES_FILTERABLE_ATTRIBUTES,
  FRAMES_SORTABLE_ATTRIBUTES,
  FRAMES_SEARCHABLE_ATTRIBUTES,
  productToDocument,
  type MedusaProductLike,
} from "@eyewear/shared";

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
  const index = meili.index(FRAMES_INDEX_NAME);
  await index.updateSettings({
    filterableAttributes: FRAMES_FILTERABLE_ATTRIBUTES,
    sortableAttributes: FRAMES_SORTABLE_ATTRIBUTES,
    searchableAttributes: FRAMES_SEARCHABLE_ATTRIBUTES,
  });

  console.log(`[reindex] Meilisearch index '${FRAMES_INDEX_NAME}' settings updated.`);

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

    const docs = (products as MedusaProductLike[]).map(productToDocument);

    await index.addDocuments(docs);
    processed += docs.length;
    offset += limit;

    console.log(`[reindex] Indexed ${processed}/${total} products…`);
  }

  console.log(`[reindex] Done. ${processed} products indexed into '${FRAMES_INDEX_NAME}'.`);
}

reindex().catch((err: unknown) => {
  console.error("[reindex] Failed:", err);
  process.exit(1);
});
