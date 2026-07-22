// @ts-nocheck
/**
 * Ensures the Meilisearch 'frames' index has the correct settings.
 * Idempotent — safe to call repeatedly.
 * Runs via: medusa exec src/scripts/setup-meilisearch.ts
 * Also called automatically when pnpm reindex runs.
 */

import "dotenv/config";
import { MeiliSearch } from "meilisearch";

const INDEX_NAME = "frames";

export async function setupMeilisearchIndex(): Promise<void> {
  const meili = new MeiliSearch({
    host: process.env.MEILISEARCH_HOST ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  });

  // Create index if it doesn't exist (idempotent)
  try {
    await meili.createIndex(INDEX_NAME, { primaryKey: "id" });
    console.log(`[meilisearch] Index '${INDEX_NAME}' created.`);
  } catch {
    // Index already exists — that's fine
  }

  const index = meili.index(INDEX_NAME);

  await index.updateSettings({
    filterableAttributes: [
      "shape",
      "material",
      "gender",
      "age_group",
      "colors",
      "collection",
      "features",
      "eye_size",
    ],
    sortableAttributes: ["price_from", "title"],
    searchableAttributes: ["title", "collection", "shape", "material"],
    displayedAttributes: [
      "id",
      "title",
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
      "features",
      "thumbnail",
    ],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
    },
  });

  console.log(`[meilisearch] Index '${INDEX_NAME}' settings applied.`);
}

// Run standalone if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupMeilisearchIndex()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error("[meilisearch] Setup failed:", err);
      process.exit(1);
    });
}
