import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { MeiliSearch } from "meilisearch";
import { FRAMES_INDEX_NAME } from "@eyewear/shared";

export default async function productDeleteSubscriber({
  event: { data },
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const client = new MeiliSearch({
    host: process.env.MEILISEARCH_HOST ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  });

  const index = client.index(FRAMES_INDEX_NAME);
  await index.deleteDocument(data.id);
}

export const config: SubscriberConfig = {
  event: "product.deleted",
};
