import { MeiliSearch } from "meilisearch";
import { FRAMES_INDEX_NAME } from "@eyewear/shared";

export const searchClient = new MeiliSearch({
  host:
    process.env.NEXT_PUBLIC_MEILISEARCH_HOST ?? "http://localhost:7700",
  apiKey: process.env.NEXT_PUBLIC_MEILISEARCH_SEARCH_KEY,
});

export const FRAMES_INDEX = FRAMES_INDEX_NAME;
