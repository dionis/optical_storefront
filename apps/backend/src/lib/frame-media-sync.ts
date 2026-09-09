/**
 * The bridge: generated files → what the storefront actually reads.
 *
 * `frame_media_asset` knows an R2 key exists; the storefront never looks at that
 * table. It reads the Store API, and the Store API only carries what is on the
 * product. So until the keys are copied into `variant.metadata`, a generated view
 * is a file nobody can reach — which is exactly the state this closes.
 *
 * SHOWS EVERYTHING GENERATED, NOT ONLY WHAT IS PUBLISHED. That is the owner's
 * decision (September 2026): `published` still records the review, but it is no
 * longer a gate for display. If that is ever reversed, the one-line change is the
 * status filter in `loadReadyAssets`.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import type { IProductModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

interface ReadyAsset {
  product_handle: string;
  variant_sku: string;
  kind: string;
  slot: string | null;
  output_key: string;
}

/** Everything with a file behind it. `stale` counts: an old view beats a hole. */
async function loadReadyAssets(
  container: MedusaContainer,
  handles?: string[]
): Promise<ReadyAsset[]> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const { rows } = await knex.raw(
    `
    SELECT product_handle, variant_sku, kind, slot, output_key
      FROM frame_media_asset
     WHERE deleted_at IS NULL
       AND status IN ('done', 'stale')
       AND output_key IS NOT NULL
       ${handles?.length ? "AND product_handle = ANY(:handles)" : ""}
     ORDER BY product_handle, variant_sku, kind, slot
    `,
    handles?.length ? { handles } : {}
  );
  return (rows ?? []) as ReadyAsset[];
}

/** The media block written onto one variant. Keys are R2 keys, never URLs. */
interface VariantMedia {
  views?: Record<string, string>;
  video?: string;
  model3d?: string;
  media_generated: true;
}

function buildMedia(assets: ReadyAsset[]): VariantMedia {
  const media: VariantMedia = { media_generated: true };
  for (const asset of assets) {
    if (asset.kind === "view" && asset.slot) {
      media.views ??= {};
      media.views[asset.slot] = asset.output_key;
    } else if (asset.kind === "video") {
      media.video = asset.output_key;
    } else if (asset.kind === "model3d") {
      media.model3d = asset.output_key;
    }
  }
  return media;
}

/** Whether the variant already carries exactly this media — avoids a pointless write. */
function unchanged(existing: Record<string, unknown>, media: VariantMedia): boolean {
  return (
    JSON.stringify(existing.views ?? null) === JSON.stringify(media.views ?? null) &&
    (existing.video ?? null) === (media.video ?? null) &&
    (existing.model3d ?? null) === (media.model3d ?? null)
  );
}

export interface SyncResult {
  variants_updated: number;
  variants_unchanged: number;
  products_seen: number;
  /** SKUs in the assets table that no live variant matches. */
  orphan_skus: string[];
}

/**
 * Copies every ready asset onto its variant's metadata.
 *
 * Idempotent, and safe to run after every generation: a variant whose media has
 * not changed is skipped rather than rewritten.
 *
 * Existing metadata is MERGED, never replaced. `variant.metadata.image` is the
 * per-colour supplier photo the storefront already renders and `upc` is real
 * inventory data — clobbering either would break the catalogue to add a feature.
 */
export async function syncVariantMedia(
  container: MedusaContainer,
  handles?: string[]
): Promise<SyncResult> {
  const assets = await loadReadyAssets(container, handles);
  if (!assets.length) {
    return { variants_updated: 0, variants_unchanged: 0, products_seen: 0, orphan_skus: [] };
  }

  const bySku = new Map<string, ReadyAsset[]>();
  for (const asset of assets) {
    const list = bySku.get(asset.variant_sku) ?? [];
    list.push(asset);
    bySku.set(asset.variant_sku, list);
  }

  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT);
  const productHandles = [...new Set(assets.map((a) => a.product_handle))];
  const products = await productService.listProducts(
    { handle: productHandles },
    { relations: ["variants"] }
  );

  const seenSkus = new Set<string>();
  let updated = 0;
  let same = 0;

  for (const product of products) {
    for (const variant of product.variants ?? []) {
      const sku = variant.sku ?? variant.id;
      const own = bySku.get(sku);
      if (!own?.length) continue;
      seenSkus.add(sku);

      const existing = (variant.metadata ?? {}) as Record<string, unknown>;
      const media = buildMedia(own);
      if (unchanged(existing, media)) {
        same += 1;
        continue;
      }

      await productService.updateProductVariants(variant.id, {
        metadata: { ...existing, ...media },
      });
      updated += 1;
    }
  }

  return {
    variants_updated: updated,
    variants_unchanged: same,
    products_seen: products.length,
    // A SKU with assets but no variant means the catalogue moved under the queue —
    // the frame was renamed or unpublished after its media was generated.
    orphan_skus: [...bySku.keys()].filter((sku) => !seenSkus.has(sku)),
  };
}
