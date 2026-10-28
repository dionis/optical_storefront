import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { STORE_ASSORTMENT_MODULE } from "../modules/store-assortment";
import type StoreAssortmentModuleService from "../modules/store-assortment/service";
import { recordAudit } from "./audit";
import { KNOWN_BRANDS } from "./costing";
import { brandExposed, brandOf, isExposed, type AssortmentRuleLike, type AssortmentScope } from "./store-assortment";

/**
 * Reads and writes of the per-store assortment (semantics in store-assortment.ts).
 * The catalog is read straight from Medusa's `product` table: published,
 * not deleted — the same set the point of sale can sell.
 */

const svc = (c: MedusaContainer) => c.resolve<StoreAssortmentModuleService>(STORE_ASSORTMENT_MODULE);
const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

export interface AssortmentRuleRow extends AssortmentRuleLike {
  id: string;
}

export async function listAssortmentRules(container: MedusaContainer, establishmentId: string): Promise<AssortmentRuleRow[]> {
  const rows = await svc(container).listStoreAssortmentRules({ establishment_id: establishmentId }, { take: 10000 });
  return rows.map((r) => ({ id: r.id, scope: String(r.scope), target: String(r.target), exposed: Boolean(r.exposed) }));
}

/**
 * Sets (or with `exposed: null` removes) the rule of one brand or model. A model
 * rule that only repeats what its brand already decides is removed instead, so
 * the list of exceptions the owner sees stays short and every row means something.
 */
export async function setAssortmentRule(
  container: MedusaContainer,
  key: { establishmentId: string; scope: AssortmentScope; target: string; brand?: string },
  exposed: boolean | null,
  actorId: string | null
): Promise<void> {
  const service = svc(container);
  const rules = await listAssortmentRules(container, key.establishmentId);
  const current = rules.find((r) => r.scope === key.scope && r.target === key.target) ?? null;
  const next = exposed !== null && key.scope === "product" && exposed === brandExposed(rules, key.brand ?? "") ? null : exposed;

  if (current && next === null) {
    await service.softDeleteStoreAssortmentRules([current.id]);
  } else if (current && next !== null && current.exposed !== next) {
    await service.updateStoreAssortmentRules({ id: current.id, exposed: next, created_by: actorId } as never);
  } else if (!current && next !== null) {
    await service.createStoreAssortmentRules({ establishment_id: key.establishmentId, scope: key.scope, target: key.target, exposed: next, created_by: actorId } as never);
  }

  await recordAudit(container, {
    actorId,
    action: "assortment.change",
    entity: "assortment_rule",
    entityId: key.target,
    establishmentId: key.establishmentId,
    before: current ? { scope: key.scope, exposed: current.exposed } : null,
    after: next === null ? null : { scope: key.scope, exposed: next },
  });
}

export interface CatalogProduct {
  id: string;
  title: string;
  thumbnail: string | null;
  brand: string;
  is_case: boolean;
}

function toProduct(r: Record<string, unknown>): CatalogProduct {
  const brand = brandOf(r["metadata"] as Record<string, unknown> | null);
  return {
    id: String(r["id"]),
    title: String(r["title"] ?? ""),
    thumbnail: (r["thumbnail"] as string | null) ?? null,
    brand,
    is_case: brand === "case",
  };
}

const published = (pg: Knex) => pg("product").whereNull("deleted_at").where("status", "published");

/** Catalog models whose title contains `q` (optionally of one brand), with their exposure in the store. */
export async function searchStoreCatalog(
  container: MedusaContainer,
  establishmentId: string,
  input: { q: string; brand?: string; limit?: number }
): Promise<Array<CatalogProduct & { exposed: boolean }>> {
  const pg = pgOf(container);
  const q = input.q.trim().slice(0, 80);
  const brand = (input.brand ?? "").trim().toLowerCase();
  if (q.length < 2 && !brand) return [];
  const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 200);
  let sql = published(pg).select("id", "title", "thumbnail", "metadata").orderBy("title").limit(limit);
  if (q.length >= 2) sql = sql.whereILike("title", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (brand) {
    sql = sql.whereRaw("lower(coalesce(metadata->>'brand_slug', metadata->>'collection_slug', '')) = ?", [brand]);
  }
  const [rows, rules] = await Promise.all([sql, listAssortmentRules(container, establishmentId)]);
  return (rows as Array<Record<string, unknown>>).map((r) => {
    const p = toProduct(r);
    return { ...p, exposed: isExposed(rules, p) };
  });
}

export interface BrandSummary {
  slug: string;
  name: string;
  /** Published models of the brand. */
  products: number;
  /** Of those, how many this store exposes (brand rule and model exceptions applied). */
  exposed_products: number;
  /** The brand's own rule: true/false, or null when it inherits (exposed). */
  rule: boolean | null;
}

/** The store's assortment: every brand of the catalog and the model exceptions. */
export async function storeAssortment(container: MedusaContainer, establishmentId: string) {
  const pg = pgOf(container);
  const [rows, rules] = await Promise.all([
    published(pg).select("id", "title", "thumbnail", "metadata") as Promise<Array<Record<string, unknown>>>,
    listAssortmentRules(container, establishmentId),
  ]);
  const products = rows.map((r) => ({ ...toProduct(r), brand_name: String((r["metadata"] as Record<string, unknown> | null)?.["brand"] ?? "") }));
  const names = new Map(KNOWN_BRANDS.map((b) => [b.slug, b.name]));

  const brands = new Map<string, BrandSummary>();
  for (const p of products) {
    const b = brands.get(p.brand) ?? {
      slug: p.brand,
      name: names.get(p.brand) || p.brand_name || p.brand,
      products: 0,
      exposed_products: 0,
      rule: rules.find((r) => r.scope === "brand" && r.target === p.brand)?.exposed ?? null,
    };
    b.products += 1;
    if (isExposed(rules, p)) b.exposed_products += 1;
    brands.set(p.brand, b);
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const exceptions = rules
    .filter((r) => r.scope === "product")
    .map((r) => {
      const p = byId.get(r.target);
      return { product_id: r.target, title: p?.title ?? null, brand: p?.brand ?? null, exposed: r.exposed };
    });

  return {
    brands: [...brands.values()].sort((a, b) => a.name.localeCompare(b.name)),
    exceptions,
    total_products: products.length,
    exposed_products: products.filter((p) => isExposed(rules, p)).length,
  };
}
