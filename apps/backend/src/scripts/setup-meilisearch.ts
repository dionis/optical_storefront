/**
 * Ensures the Meilisearch 'frames' index has the correct settings.
 * Idempotent — safe to call repeatedly.
 * Runs via: medusa exec src/scripts/setup-meilisearch.ts
 * Also called automatically when pnpm reindex runs.
 */

import "dotenv/config";
import { MeiliSearch } from "meilisearch";
import {
  FRAMES_INDEX_NAME,
  FRAMES_FILTERABLE_ATTRIBUTES,
  FRAMES_SORTABLE_ATTRIBUTES,
  FRAMES_SEARCHABLE_ATTRIBUTES,
  FRAMES_DISPLAYED_ATTRIBUTES,
} from "@eyewear/shared";

export async function setupMeilisearchIndex(): Promise<void> {
  const meili = new MeiliSearch({
    host: process.env.MEILISEARCH_HOST ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  });

  // Create index if it doesn't exist (idempotent)
  try {
    await meili.createIndex(FRAMES_INDEX_NAME, { primaryKey: "id" });
    console.log(`[meilisearch] Index '${FRAMES_INDEX_NAME}' created.`);
  } catch {
    // Index already exists — that's fine
  }

  const index = meili.index(FRAMES_INDEX_NAME);

  await index.updateSettings({
    filterableAttributes: FRAMES_FILTERABLE_ATTRIBUTES,
    sortableAttributes: FRAMES_SORTABLE_ATTRIBUTES,
    searchableAttributes: FRAMES_SEARCHABLE_ATTRIBUTES,
    displayedAttributes: FRAMES_DISPLAYED_ATTRIBUTES,
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
    },
  });

  console.log(`[meilisearch] Index '${FRAMES_INDEX_NAME}' settings applied.`);
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
