import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import type StorePricingModuleService from "../modules/store-pricing/service";
import { catalogBrandId } from "../modules/store-pricing/catalog-brand-seed";
import { recordAudit } from "./audit";
import { brandSqlOf } from "./store-assortment";
import {
  derivedBrandRow,
  mergeBrands,
  type BrandKind,
  type BrandRow,
  type BrandSource,
  type BrandView,
  type CatalogBrandCount,
} from "./catalog-brand";

/**
 * Reads and writes of the brand registry (`catalog_brand`, lib/catalog-brand.ts
 * for the semantics). The catalogue is the truth about which brands exist, so
 * every list REGISTERS the catalogue slugs the registry lacks before answering
 * (one INSERT … ON CONFLICT DO NOTHING) — a brand the scraper brings shows up
 * with its logo, never vanishes, and can then be renamed or given a logo.
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const svc = (c: MedusaContainer) => c.resolve<StorePricingModuleService>(STORE_PRICING_MODULE);

/** The statuses that count as «the brand has models» (the matrix lists both). */
const LISTED_STATUSES = ["published", "draft"];

const toBrand = (r: Record<string, unknown>): BrandRow => ({
  slug: String(r["slug"] ?? ""),
  name: String(r["name"] ?? r["slug"] ?? ""),
  logo_url: (r["logo_url"] as string | null) ?? null,
  kind: (r["kind"] === "case" ? "case" : "frame") as BrandKind,
  source: (r["source"] === "manual" ? "manual" : "capri") as BrandSource,
  active: r["active"] !== false,
  sort: Math.round(Number(r["sort"]) || 0),
});

/** Live registry rows. Throws — callers decide (an un-migrated table is «no registry»). */
export async function listRegistryBrands(container: MedusaContainer): Promise<BrandRow[]> {
  const rows = (await svc(container).listCatalogBrands({}, { take: 1000 })) as unknown as Record<string, unknown>[];
  return rows.filter((r) => !r["deleted_at"]).map(toBrand);
}

/** Every slug of the catalogue (published + draft) with its counts — ONE query. */
export async function catalogueBrandCounts(container: MedusaContainer): Promise<CatalogBrandCount[]> {
  const pg = pgOf(container);
  const rows = (await pg("product")
    .whereNull("deleted_at")
    .whereIn("status", LISTED_STATUSES)
    .select(pg.raw(`${brandSqlOf("product")} as slug`))
    .select(pg.raw(`max(metadata->>'brand') as name`))
    .select(pg.raw(`count(*) filter (where metadata->>'kind' = 'case') as cases`))
    .select(pg.raw(`bool_and(coalesce(metadata->>'source', '') = 'manual') as manual`))
    .count({ models: "*" })
    .groupByRaw("1")) as Array<Record<string, unknown>>;
  return rows
    .map((r) => ({
      slug: String(r["slug"] ?? "").trim(),
      name: String(r["name"] ?? "").trim(),
      models: Number(r["models"]) || 0,
      cases: Number(r["cases"]) || 0,
      manual: r["manual"] === true,
    }))
    .filter((r) => r.slug);
}

/** Registers brands the catalogue carries and the registry lacks. Idempotent; never overwrites a row. */
export async function registerBrands(container: MedusaContainer, rows: readonly BrandRow[]): Promise<number> {
  if (!rows.length) return 0;
  const pg = pgOf(container);
  const result = await pg.raw(
    `INSERT INTO catalog_brand (id, slug, name, logo_url, kind, source, active, sort)
     VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
     ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING`,
    rows.flatMap((b) => [catalogBrandId(b.slug), b.slug, b.name, b.logo_url, b.kind, b.source, b.active, b.sort])
  );
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

/**
 * The registry merged with the catalogue (`mergeBrands`), registering what is
 * missing first. Without the table (un-migrated) the brands are derived from
 * the catalogue alone, as before v2. Throws only when the catalogue itself
 * cannot be read.
 */
export async function listBrands(container: MedusaContainer): Promise<BrandView[]> {
  const counts = await catalogueBrandCounts(container);
  let registry: BrandRow[];
  try {
    registry = await listRegistryBrands(container);
  } catch (error) {
    container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[catalog] brand registry unavailable: ${(error as Error).message}`);
    return mergeBrands([], counts);
  }
  const known = new Set(registry.map((b) => b.slug));
  const missing = counts.filter((c) => !known.has(c.slug)).map(derivedBrandRow);
  if (missing.length) {
    try {
      await registerBrands(container, missing);
      registry = [...registry, ...missing];
    } catch (error) {
      container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[catalog] could not register ${missing.length} brands: ${(error as Error).message}`);
    }
  }
  return mergeBrands(registry, counts);
}

/** Logos by slug for the matrix headers (absolute or origin paths). Never throws. */
export async function brandLogos(container: MedusaContainer): Promise<Map<string, string | null>> {
  try {
    return new Map((await listBrands(container)).map((b) => [b.slug, b.logo_url]));
  } catch {
    return new Map();
  }
}

/** One live registry row by slug, or null. */
async function findBrand(container: MedusaContainer, slug: string): Promise<(BrandRow & { id: string }) | null> {
  const rows = (await svc(container).listCatalogBrands({ slug } as never, { take: 5 })) as unknown as Record<string, unknown>[];
  const live = rows.find((r) => !r["deleted_at"]);
  return live ? { ...toBrand(live), id: String(live["id"]) } : null;
}

/** `POST /admin/catalog/brands`: a new brand (`manual`). `brand_taken` when the slug is live. */
export async function createBrand(
  container: MedusaContainer,
  input: { slug: string; name: string; kind: BrandKind; logo_url: string | null; sort: number },
  actorId: string | null
): Promise<{ brand: BrandView } | { reason: string }> {
  const [existing, counts] = await Promise.all([findBrand(container, input.slug), catalogueBrandCounts(container).catch(() => [] as CatalogBrandCount[])]);
  // A slug the catalogue already carries is a brand that exists, registered or not.
  if (existing || counts.some((c) => c.slug === input.slug)) return { reason: "brand_taken" };
  const row: BrandRow = { slug: input.slug, name: input.name, kind: input.kind, logo_url: input.logo_url, source: "manual", active: true, sort: input.sort };
  await svc(container).createCatalogBrands({ ...row, created_by: actorId, updated_by: actorId } as never);
  await recordAudit(container, { actorId, action: "catalog.create", entity: "catalog_brand", entityId: input.slug, after: row as unknown as Record<string, unknown> });
  return { brand: mergeBrands([row], [])[0] as BrandView };
}

/**
 * `POST /admin/catalog/brands/:slug`: changes the fields sent. A brand the
 * catalogue carries but the registry lacks is registered first, so it can be
 * edited like any other. `brand_not_found` when neither knows the slug.
 */
export async function updateBrand(
  container: MedusaContainer,
  slug: string,
  patch: Partial<Pick<BrandRow, "name" | "logo_url" | "active" | "sort" | "kind">>,
  actorId: string | null
): Promise<{ brand: BrandView } | { reason: string }> {
  const counts = await catalogueBrandCounts(container).catch(() => [] as CatalogBrandCount[]);
  let current = await findBrand(container, slug);
  if (!current) {
    const derived = counts.find((c) => c.slug === slug);
    if (!derived) return { reason: "brand_not_found" };
    await registerBrands(container, [derivedBrandRow(derived)]);
    current = await findBrand(container, slug);
    if (!current) return { reason: "brand_not_found" };
  }
  const { id, ...before } = current;
  await svc(container).updateCatalogBrands([{ id, ...patch, updated_by: actorId }] as never);
  const after: BrandRow = { ...before, ...patch };
  await recordAudit(container, {
    actorId,
    action: "catalog.update",
    entity: "catalog_brand",
    entityId: slug,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
  });
  return { brand: mergeBrands([after], counts.filter((c) => c.slug === slug))[0] as BrandView };
}

/**
 * `DELETE /admin/catalog/brands/:slug`: only a brand with no model left (any
 * status but deleted — a discontinued model still belongs to it): otherwise
 * `brand_has_models` with the count. Soft delete. `brand_not_found` when the
 * registry has no such row.
 */
export async function deleteBrand(container: MedusaContainer, slug: string, actorId: string | null): Promise<{ deleted: true } | { reason: string; models?: number }> {
  const pg = pgOf(container);
  const [{ n } = { n: 0 }] = (await pg("product")
    .whereNull("deleted_at")
    .whereRaw(`${brandSqlOf("product")} = ?`, [slug])
    .count({ n: "*" })) as Array<{ n: number | string }>;
  const models = Number(n) || 0;
  if (models > 0) return { reason: "brand_has_models", models };
  const current = await findBrand(container, slug);
  if (!current) return { reason: "brand_not_found" };
  await svc(container).softDeleteCatalogBrands([current.id]);
  const { id: _id, ...before } = current;
  await recordAudit(container, { actorId, action: "catalog.delete", entity: "catalog_brand", entityId: slug, before: before as unknown as Record<string, unknown>, after: null });
  return { deleted: true };
}
