import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { IProductModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { MeiliSearch } from "meilisearch";
import { FRAMES_INDEX_NAME, productToDocument, type MedusaProductLike } from "@eyewear/shared";

function getMeilisearchClient(): MeiliSearch {
  return new MeiliSearch({
    host: process.env.MEILISEARCH_HOST ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  });
}

export default async function productUpsertSubscriber({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT);
  let product: MedusaProductLike;

  try {
    product = (await productService.retrieveProduct(data.id, {
      relations: ["variants", "variants.prices", "images", "collection"],
    })) as MedusaProductLike;
  } catch {
    // Product may not exist (deleted event handled separately)
    return;
  }

  const client = getMeilisearchClient();
  const index = client.index(FRAMES_INDEX_NAME);
  await index.addDocuments([productToDocument(product)]);
}

export const config: SubscriberConfig = {
  event: [
    "product.created",
    "product.updated",
  ],
};
