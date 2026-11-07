import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  createAndLinkProductOptionsToProductWorkflow,
  createProductVariantsWorkflow,
  deleteProductsWorkflow,
  deleteProductVariantsWorkflow,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows";
import type { Knex } from "@mikro-orm/knex";
import { recordAudit } from "./audit";
import { attributeMetadata, planColorEdit, type CatalogFramePatch, type ExistingVariant } from "./catalog-frame";
import { importSkuKey } from "./price-matrix";

/**
 * Editing and removing a model of «Productos y precios» (docs/PRICE-MATRIX.md
 * v2 «Modelos: alta, edición, baja»). The pure planning is in
 * lib/catalog-frame.ts (`cleanCatalogFramePatch`, `planColorEdit`); this file
 * runs it through Medusa's own product workflows — the same ones the admin API
 * uses — so links, prices and the search index stay consistent.
 *
 * «SOLD» means a sale line exists for it: a Medusa order line
 * (`order_line_item`, web and till alike) or a till fact (`sale_fact`). A
 * colour or a model that was ever sold is never deleted: a receipt, a margin
 * and the accounting point at it.
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/** The variants among `ids` that appear on any sale line. Never throws on a missing `sale_fact`. */
export async function soldVariantIds(container: MedusaContainer, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const pg = pgOf(container);
  const sold = new Set<string>();
  const lines = (await pg("order_line_item").whereNull("deleted_at").whereIn("variant_id", ids).distinct("variant_id")) as Array<{ variant_id: string }>;
  for (const l of lines) sold.add(String(l.variant_id));
  try {
    const facts = (await pg("sale_fact").whereNull("deleted_at").whereIn("variant_id", ids).distinct("variant_id")) as Array<{ variant_id: string }>;
    for (const f of facts) sold.add(String(f.variant_id));
  } catch {
    // No till facts table: the order lines decide alone.
  }
  return [...sold];
}

/** Whether any colour of the product was ever sold. */
export async function productWasSold(container: MedusaContainer, productId: string): Promise<boolean> {
  const pg = pgOf(container);
  const line = await pg("order_line_item").whereNull("deleted_at").where("product_id", productId).first("id");
  if (line) return true;
  try {
    const fact = await pg("sale_fact").whereNull("deleted_at").where("product_id", productId).first("id");
    return Boolean(fact);
  } catch {
    return false;
  }
}

interface LoadedProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  description: string | null;
  thumbnail: string | null;
  metadata: Record<string, unknown>;
  images: string[];
  colorOptionId: string | null;
  variants: Array<ExistingVariant & { usd: number | null }>;
}

async function loadProduct(container: MedusaContainer, productId: string): Promise<LoadedProduct | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "status",
      "description",
      "thumbnail",
      "metadata",
      "images.url",
      "options.id",
      "options.title",
      "variants.id",
      "variants.title",
      "variants.sku",
      "variants.metadata",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    filters: { id: productId },
  });
  const p = (data as Array<Record<string, any>>)[0];
  if (!p) return null;
  const options = (p.options ?? []) as Array<{ id: string; title?: string }>;
  return {
    id: String(p.id),
    title: String(p.title ?? ""),
    handle: String(p.handle ?? ""),
    status: String(p.status ?? ""),
    description: (p.description as string | null) ?? null,
    thumbnail: (p.thumbnail as string | null) ?? null,
    metadata: (p.metadata ?? {}) as Record<string, unknown>,
    images: ((p.images ?? []) as Array<{ url?: string }>).map((i) => String(i.url ?? "")).filter(Boolean),
    colorOptionId: options.find((o) => String(o.title ?? "").toLowerCase() === "color")?.id ?? null,
    variants: ((p.variants ?? []) as Array<Record<string, any>>).map((v) => {
      const usd = ((v.prices ?? []) as Array<{ amount?: number; currency_code?: string }>).find((x) => x.currency_code === "usd");
      return {
        id: String(v.id),
        title: String(v.title ?? ""),
        sku: (v.sku as string | null) ?? null,
        metadata: (v.metadata ?? null) as Record<string, unknown> | null,
        usd: usd?.amount == null ? null : Number(usd.amount),
      };
    }),
  };
}

/** The SKU that names the model: the colour whose SKU spells the title, else the shortest. */
function modelSkuOfProduct(p: LoadedProduct): string {
  const titleKey = importSkuKey(p.title);
  const skus = p.variants.map((v) => v.sku).filter((s): s is string => !!s);
  return skus.find((s) => importSkuKey(s) === titleKey) ?? [...skus].sort((a, b) => a.length - b.length)[0] ?? p.title;
}

/**
 * `POST /admin/catalog/frames/:id`. Returns the reason code of a refusal:
 * `product_not_found`, `bad_colors` (a `variant_id` not of this product),
 * `variant_sold` (with the ids: a colour that was sold cannot be removed).
 * Writes, in this order: the «Color» values the new names need, the new
 * colours, the renamed ones, the product (title, description, status,
 * gallery, metadata MERGED — Medusa replaces it), then the removed colours.
 * Audited as `catalog.update`.
 */
export async function updateCatalogFrame(
  container: MedusaContainer,
  productId: string,
  patch: CatalogFramePatch,
  actorId: string | null
): Promise<{ product_id: string } | { reason: string; variant_ids?: string[] }> {
  const p = await loadProduct(container, productId);
  if (!p) return { reason: "product_not_found" };

  const plan = patch.colors ? planColorEdit(p.variants, patch.colors, modelSkuOfProduct(p)) : null;
  if (plan?.unknown.length) return { reason: "bad_colors", variant_ids: plan.unknown };
  if (plan?.remove.length) {
    const sold = await soldVariantIds(container, plan.remove);
    if (sold.length) return { reason: "variant_sold", variant_ids: sold };
  }

  if (plan?.newOptionValues.length) {
    await createAndLinkProductOptionsToProductWorkflow(container).run({
      input: p.colorOptionId
        ? { product_id: p.id, update: [{ product_option_id: p.colorOptionId, add: plan.newOptionValues.map((value) => ({ value })) }] }
        : { product_id: p.id, add: [{ title: "Color", values: plan.newOptionValues } as never] },
    });
  }
  const price = p.variants.find((v) => v.usd != null)?.usd ?? null;
  if (plan?.create.length) {
    await createProductVariantsWorkflow(container).run({
      input: {
        product_variants: plan.create.map((c) => ({
          product_id: p.id,
          title: c.name,
          sku: c.sku,
          options: { Color: c.name },
          manage_inventory: false,
          prices: price == null ? [] : [{ currency_code: "usd", amount: price }],
          metadata: { color: c.name, image: c.image },
        })) as never,
      },
    });
  }
  if (plan?.update.length) {
    const byId = new Map(p.variants.map((v) => [v.id, v]));
    await updateProductVariantsWorkflow(container).run({
      input: {
        product_variants: plan.update.map((u) => {
          const v = byId.get(u.id);
          const metadata = { ...(v?.metadata ?? {}), color: u.name, ...(u.image !== undefined ? { image: u.image } : {}) };
          return { id: u.id, title: u.name, ...(u.renamed ? { options: { Color: u.name } } : {}), metadata };
        }) as never,
      },
    });
  }

  const metadata: Record<string, unknown> = {
    ...p.metadata,
    ...attributeMetadata(patch.attributes),
    ...(patch.brand !== undefined ? { brand: patch.brand } : {}),
    ...(patch.brand_slug !== undefined ? { brand_slug: patch.brand_slug, collection_slug: patch.brand_slug } : {}),
    ...("eye_size" in patch ? { eye_size: patch.eye_size } : {}),
    ...("bridge_size" in patch ? { bridge_size: patch.bridge_size } : {}),
    ...("temple_length" in patch ? { temple_length: patch.temple_length } : {}),
    edited_at: new Date().toISOString(),
    edited_by: actorId,
  };
  const productUpdate: Record<string, unknown> = { id: p.id, metadata };
  if (patch.title !== undefined) productUpdate["title"] = patch.title;
  if (patch.description !== undefined) productUpdate["description"] = patch.description;
  if (patch.status !== undefined) productUpdate["status"] = patch.status;
  if (patch.images !== undefined) {
    productUpdate["images"] = patch.images.map((url) => ({ url }));
    productUpdate["thumbnail"] = patch.images[0] ?? null;
  }
  await updateProductsWorkflow(container).run({ input: { products: [productUpdate as never] } });

  if (plan?.remove.length) await deleteProductVariantsWorkflow(container).run({ input: { ids: plan.remove } });

  await recordAudit(container, {
    actorId,
    action: "catalog.update",
    entity: "product",
    entityId: p.id,
    before: { title: p.title, status: p.status, colors: p.variants.map((v) => v.title) },
    after: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      fields: Object.keys(productUpdate).filter((k) => k !== "id"),
      attributes: Object.keys(patch.attributes),
      colors: plan ? { added: plan.create.map((c) => c.name), renamed: plan.update.filter((u) => u.renamed).map((u) => u.name), removed: plan.remove.length } : null,
    },
  });
  return { product_id: p.id };
}

/**
 * `DELETE /admin/catalog/frames/:id`: a model never sold is deleted
 * (`deleteProductsWorkflow`, soft delete in Medusa); one that was sold goes to
 * «descontinuado» (draft) so its sales keep pointing at it. Audited as
 * `catalog.delete` either way.
 */
export async function deleteCatalogFrame(
  container: MedusaContainer,
  productId: string,
  actorId: string | null
): Promise<{ deleted: true } | { archived: true } | { reason: string }> {
  const p = await loadProduct(container, productId);
  if (!p) return { reason: "product_not_found" };
  const sold = await productWasSold(container, p.id);
  if (sold) {
    await updateProductsWorkflow(container).run({
      input: { products: [{ id: p.id, status: "draft", metadata: { ...p.metadata, archived_at: new Date().toISOString(), archived_by: actorId } } as never] },
    });
  } else {
    await deleteProductsWorkflow(container).run({ input: { ids: [p.id] } });
  }
  await recordAudit(container, {
    actorId,
    action: "catalog.delete",
    entity: "product",
    entityId: p.id,
    before: { title: p.title, status: p.status, colors: p.variants.length },
    after: sold ? { status: "draft", archived: true } : null,
  });
  return sold ? { archived: true } : { deleted: true };
}
