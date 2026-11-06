import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { STORE_ASSORTMENT_MODULE } from "../modules/store-assortment";
import type StoreAssortmentModuleService from "../modules/store-assortment/service";
import type { EstablishmentRow } from "./establishments";
import {
  catalogSellingPrices,
  frameCostKeyOf,
  indexFrameCostVariations,
  listFrameCostVariations,
  listFrameCosts,
  resolveFrameCost,
  type CatalogModel,
  type FrameCostRow,
  type FrameCostVariationIndex,
} from "./frame-cost";
import { brandOf, isExposed, type AssortmentRuleLike } from "./store-assortment";
import { hasGlobalPrice, storeLinePrice, type PriceRuleLike } from "./store-pricing";
import { openRules, productPrices } from "./store-pricing-data";

/**
 * HU-13 — «Como dueño, quiero ver un producto con su precio en todas las
 * tiendas.» Every other pricing view is per store; this one is per MODEL: one
 * row, one column per active store, the figure each till would charge today.
 *
 * Nothing here computes a price of its own. Each store cell is
 * `storeLinePrice` (the till's function, lib/store-pricing.ts) and the master
 * cell is `catalogSellingPrices` (the figure the costs tab and the catalogue
 * card show), so this screen can never disagree with the receipt. Exposure is
 * `isExposed` (store-assortment), the cost is `resolveFrameCost` (frame-cost).
 */

export const ACROSS_LIMIT = 20;
export const ACROSS_MIN_QUERY = 2;

/** A matched catalogue model, as the search query returns it. */
export interface AcrossProduct {
  product_id: string;
  title: string;
  thumbnail: string | null;
  brand: string;
  /** Every live variant SKU (colours share the price; the owner searches by any). */
  skus: string[];
  /** Medusa price of the model in USD; null when it has none. */
  base: number | null;
}

/** The store half of the input: the active stores and each one's assortment rules. */
export interface AcrossStore {
  id: string;
  code: string;
  name: string;
  color: string;
  assortment: AssortmentRuleLike[];
}

/** The cost side, present only for a reader with cost privileges. */
export interface AcrossCosts {
  rows: ReadonlyMap<string, FrameCostRow>;
  variations: FrameCostVariationIndex;
}

export type AcrossSource = "exact" | "band" | "adjusted" | "base";
export type AcrossMasterSource = "owner" | "band" | "base";

export interface AcrossStoreCell {
  establishment_id: string;
  code: string;
  name: string;
  color: string;
  /** What the till charges for the frame alone, in cents; null when the model has no price. */
  price_cents: number | null;
  /** What produced it: the store's exact price, the band, an adjustment, or the bare base. */
  source: AcrossSource;
  /** Whether the store sells the model at all (store-assortment). */
  exposed: boolean;
  /** What THIS store pays (its variation or the master); only for cost viewers. */
  cost_cents?: number | null;
}

export interface AcrossRow {
  product_id: string;
  title: string;
  brand: string;
  thumbnail: string | null;
  /** The model's SKU (the first colour's) and every colour's. */
  sku: string;
  skus: string[];
  is_case: boolean;
  /** Medusa price before any rule, in cents; null when the model has none. */
  base_cents: number | null;
  /** The chain's price (the owner's global price, else base through the band), in cents. */
  master_price_cents: number | null;
  master_source: AcrossMasterSource;
  /** The chain's cost; only for cost viewers (`redactAcrossCosts`). */
  cost_cents?: number | null;
  stores: AcrossStoreCell[];
}

const cents = (usd: number) => Math.round(usd * 100);

function sourceOf(line: ReturnType<typeof storeLinePrice>): AcrossSource {
  if (line.frame_source === "store_exact") return "exact";
  if (line.band) return "band";
  return line.adjustment ? "adjusted" : "base";
}

/**
 * One row per matched model with the price in every store. PURE — this is the
 * function the tests pin. `costs` null = the reader may not see costs and no
 * `cost_cents` key is written anywhere.
 */
export function buildAcrossRows(
  products: readonly AcrossProduct[],
  stores: readonly AcrossStore[],
  rules: PriceRuleLike[],
  costs: AcrossCosts | null,
  now = new Date()
): AcrossRow[] {
  const models: CatalogModel[] = products.map((p) => ({
    product_id: p.product_id,
    sku: p.skus[0] ?? p.title,
    title: p.title,
    brand_slug: p.brand,
    is_case: p.brand === "case" || p.brand === "cases",
    price_cents: p.base == null ? null : cents(p.base),
  }));
  return models.map((m, i) => {
    const p = products[i];
    const scope = m.is_case ? "case" : "frame";
    // The chain's figure, from the SAME function the costs tab joins on — one
    // model at a time, so two models normalising to one SKU key never shadow
    // each other here (there, the first wins on purpose).
    const masterHit = catalogSellingPrices([m], rules, null, now).get(frameCostKeyOf(m.sku));
    const owner = hasGlobalPrice(rules, scope, m.product_id, now);
    const masterPrice = masterHit ? masterHit.price_cents : null;
    const row: AcrossRow = {
      product_id: m.product_id,
      title: m.title,
      brand: m.brand_slug,
      thumbnail: p.thumbnail,
      sku: m.sku,
      skus: p.skus,
      is_case: m.is_case,
      base_cents: m.price_cents,
      master_price_cents: masterPrice,
      master_source: owner ? "owner" : masterPrice != null && masterPrice !== m.price_cents ? "band" : "base",
      stores: stores.map((s) => {
        const line =
          m.price_cents == null
            ? null
            : storeLinePrice(rules, { establishmentId: s.id, scope, target: m.product_id, base: m.price_cents / 100, lenses: 0 }, now);
        const cell: AcrossStoreCell = {
          establishment_id: s.id,
          code: s.code,
          name: s.name,
          color: s.color,
          price_cents: line ? cents(line.frame) : null,
          source: line ? sourceOf(line) : "base",
          exposed: isExposed(s.assortment, { id: m.product_id, brand: m.brand_slug }),
        };
        if (costs) cell.cost_cents = resolveFrameCost(costs.rows, costs.variations, m.sku, s.id)?.cost_cents ?? null;
        return cell;
      }),
    };
    if (costs) row.cost_cents = resolveFrameCost(costs.rows, costs.variations, m.sku, null)?.cost_cents ?? null;
    return row;
  });
}

/**
 * The rows as a reader WITHOUT cost privileges may see them: no `cost_cents`
 * anywhere. Done on the server, like `redactLensCosts`. Pure.
 */
export function redactAcrossCosts(rows: AcrossRow[], canSeeCosts: boolean): AcrossRow[] {
  if (canSeeCosts) return rows;
  return rows.map((r) => {
    const { cost_cents: _c, ...rest } = r;
    return {
      ...rest,
      stores: r.stores.map((s) => {
        const { cost_cents: _sc, ...cell } = s;
        return cell;
      }),
    };
  });
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** `%`, `_` and `\` typed by the owner are characters to find, not wildcards. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Published models whose title OR any colour's SKU contains `q`, with every
 * live SKU and the Medusa price. One query; the first `ACROSS_LIMIT` by title.
 */
export async function searchAcrossProducts(container: MedusaContainer, q: string): Promise<AcrossProduct[]> {
  const needle = q.trim().slice(0, 80);
  if (needle.length < ACROSS_MIN_QUERY) return [];
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const pattern = like(needle);
  const rows = (await pg("product")
    .whereNull("product.deleted_at")
    .where("product.status", "published")
    .where((b) => {
      b.whereILike("product.title", pattern).orWhereExists(
        pg("product_variant as v").whereRaw("v.product_id = product.id").whereNull("v.deleted_at").whereILike("v.sku", pattern)
      );
    })
    .select("product.id", "product.title", "product.thumbnail", "product.metadata")
    .select(
      pg.raw(
        `(select coalesce(array_agg(v.sku order by v.id), '{}') from product_variant v
          where v.product_id = product.id and v.deleted_at is null and v.sku is not null) as skus`
      )
    )
    .orderBy("product.title")
    .limit(ACROSS_LIMIT)) as Array<Record<string, unknown>>;
  if (!rows.length) return [];
  // The Medusa price through the same reader every preview uses (one query).
  const prices = new Map((await productPrices(container, rows.map((r) => String(r["id"])))).map((p) => [p.product_id, p.price]));
  return rows.map((r) => ({
    product_id: String(r["id"]),
    title: String(r["title"] ?? ""),
    thumbnail: (r["thumbnail"] as string | null) ?? null,
    brand: brandOf(r["metadata"] as Record<string, unknown> | null),
    skus: Array.isArray(r["skus"]) ? (r["skus"] as unknown[]).map(String).filter(Boolean) : [],
    base: prices.get(String(r["id"])) ?? null,
  }));
}

/** Every assortment rule of the given stores in ONE query, grouped by store. */
export async function assortmentByStore(
  container: MedusaContainer,
  storeIds: string[]
): Promise<Map<string, AssortmentRuleLike[]>> {
  const out = new Map<string, AssortmentRuleLike[]>(storeIds.map((id) => [id, []]));
  if (!storeIds.length) return out;
  try {
    const rows = (await container
      .resolve<StoreAssortmentModuleService>(STORE_ASSORTMENT_MODULE)
      .listStoreAssortmentRules({ establishment_id: storeIds } as never, { take: 20000 })) as unknown as Record<string, unknown>[];
    for (const r of rows) {
      if (r["deleted_at"]) continue;
      const bucket = out.get(String(r["establishment_id"]));
      if (bucket) bucket.push({ scope: String(r["scope"]), target: String(r["target"]), exposed: Boolean(r["exposed"]) });
    }
  } catch {
    // An un-migrated table is "every store exposes everything", the default.
  }
  return out;
}

/**
 * The whole read of `GET /admin/pricing/frames/across`: the matched models,
 * the active stores, the open rules of all of them (one query), the assortment
 * (one query) and — for a cost viewer — the master costs and every store's
 * variations (two queries). Never a query per model or per store.
 */
export async function loadPricingAcross(
  container: MedusaContainer,
  input: { q: string; stores: EstablishmentRow[]; withCosts: boolean }
): Promise<{ rows: AcrossRow[]; stores: Array<{ id: string; code: string; name: string; color: string }> }> {
  const active = input.stores.filter((s) => s.is_active);
  const ids = active.map((s) => s.id);
  const products = await searchAcrossProducts(container, input.q);
  const summary = active.map((s) => ({ id: s.id, code: String(s.code ?? ""), name: String(s.name ?? ""), color: String(s.color ?? "") }));
  if (!products.length) return { rows: [], stores: summary };
  const [rules, assortment, costRows, variations] = await Promise.all([
    openRules(container, ids).catch(() => [] as PriceRuleLike[]),
    assortmentByStore(container, ids),
    input.withCosts ? listFrameCosts(container).catch(() => [] as FrameCostRow[]) : Promise.resolve([] as FrameCostRow[]),
    input.withCosts ? listFrameCostVariations(container).catch(() => []) : Promise.resolve([]),
  ]);
  const stores: AcrossStore[] = summary.map((s) => ({ ...s, assortment: assortment.get(s.id) ?? [] }));
  const costs: AcrossCosts | null = input.withCosts
    ? { rows: new Map(costRows.map((r) => [r.sku, r])), variations: indexFrameCostVariations(variations) }
    : null;
  return { rows: buildAcrossRows(products, stores, rules, costs), stores: summary };
}
