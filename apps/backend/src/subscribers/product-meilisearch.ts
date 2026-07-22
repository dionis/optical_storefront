// @ts-nocheck
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { MeiliSearch } from "meilisearch";
import type { MeilisearchFrameDocument } from "@eyewear/shared";

const INDEX_NAME = "frames";

function getMeilisearchClient(): MeiliSearch {
  return new MeiliSearch({
    host: process.env.MEILISEARCH_HOST ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  });
}

/**
 * Maps a Medusa product (with frame metadata) to a Meilisearch document.
 * Product metadata is stored under product.metadata per Medusa convention.
 */
function productToDocument(product: Record<string, unknown>): MeilisearchFrameDocument {
  const meta = (product["metadata"] ?? {}) as Record<string, unknown>;
  const variants = (product["variants"] ?? []) as Array<Record<string, unknown>>;

  const colors: string[] = variants
    .map((v) => v["title"] as string)
    .filter(Boolean);

  const prices = variants
    .flatMap((v) => (v["prices"] ?? []) as Array<Record<string, unknown>>)
    .map((p) => p["amount"] as number)
    .filter((a) => typeof a === "number");

  const price_from = prices.length > 0 ? Math.min(...prices) : 0;

  const thumbnail =
    (product["thumbnail"] as string | null) ??
    ((product["images"] as Array<{ url: string }>)?.[0]?.url ?? "");

  return {
    id: product["id"] as string,
    title: product["title"] as string,
    handle: product["handle"] as string,
    collection: (meta["collection_slug"] as string) ?? "",
    shape: (meta["shape"] as string) ?? "",
    material: (meta["material"] as string) ?? "",
    gender: (meta["gender"] as string) ?? "",
    age_group: (meta["age_group"] as string) ?? "",
    colors,
    eye_size: (meta["eye_size"] as number) ?? 0,
    bridge_size: (meta["bridge_size"] as number) ?? 0,
    temple_length: (meta["temple_length"] as number) ?? 0,
    price_from,
    features: (meta["features"] as string[]) ?? [],
    thumbnail,
  };
}

export default async function productUpsertSubscriber({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const productService = container.resolve("productModuleService");
  let product: Record<string, unknown>;

  try {
    product = await productService.retrieveProduct(data.id, {
      relations: ["variants", "variants.prices", "images", "collection"],
    });
  } catch {
    // Product may not exist (deleted event handled separately)
    return;
  }

  const client = getMeilisearchClient();
  const index = client.index(INDEX_NAME);
  await index.addDocuments([productToDocument(product)]);
}

export const config: SubscriberConfig = {
  event: [
    "product.created",
    "product.updated",
  ],
};
