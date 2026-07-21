import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { MeiliSearch } from "meilisearch";

const INDEX_NAME = "frames";

export default async function productDeleteSubscriber({
  event: { data },
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const client = new MeiliSearch({
    host: process.env.MEILISEARCH_HOST ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  });

  const index = client.index(INDEX_NAME);
  await index.deleteDocument(data.id);
}

export const config: SubscriberConfig = {
  event: "product.deleted",
};
