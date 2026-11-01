import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CAPRI_BY_KEY, capriKeyOf } from "../modules/store-pricing/capri-price-list-2026";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import type StorePricingModuleService from "../modules/store-pricing/service";
import { brandOf } from "./store-assortment";

/**
 * What the shop PAYS for a frame or case model — the supplier's figure, or the
 * one the owner typed over it (`store_frame_cost`, see
 * modules/store-pricing/models/frame-cost.ts).
 *
 * The owner: "cost and price must appear in every commercial view, and they
 * must be editable, so the accounting is 100 % reliable." Two consequences
 * live in this file:
 *
 *  1. ONE resolution order, used by the panel, the cost sheet and the sheet
 *     mirror alike: the stored row (the owner's edit beats nothing, because an
 *     edit IS the row) → the supplier list compiled into the build → NULL.
 *     Never 0: a silent zero turns a case with no known cost into a 100 %
 *     margin, which is exactly the lie this work removes. A null is reported
 *     as "cost unknown" (`undefined_cost` / `missing_cost`).
 *
 *  2. The lookup `lib/costing.ts` needs is SYNCHRONOUS (`computeCostSheet` is
 *     pure and is called per sale line, thousands of times in one dashboard
 *     query), so the table is held in a short-lived process cache refreshed by
 *     `ensureFrameCostCache` — which `listCostRules` calls, i.e. everything
 *     that computes a cost sheet already warms it. With an empty or stale
 *     cache the answer degrades to the compiled supplier list, never to zero.
 */

export const FRAME_COST_SOURCES = ["supplier_list", "owner_edit"] as const;
export type FrameCostSource = (typeof FRAME_COST_SOURCES)[number];

export interface FrameCostRow {
  /** Normalised key (A-Z0-9) the catalogue SKU resolves to. */
  sku: string;
  /** Model as the supplier prints it ("CASE SC-2 W/CLIP"). */
  model: string;
  /** The supplier's catalogue ("book") price, in cents. */
  book_cents: number;
  /** What the shop pays, in cents. The only figure a margin uses. */
  cost_cents: number;
  source: FrameCostSource;
  /** ISO instant of the last change; null for a row that is still the list's. */
  updated_at: string | null;
  updated_by: string | null;
}

/** The synchronous lookup `computeCostSheet` takes: cents, or null when unknown. */
export type FrameCostLookup = (sku: string) => number | null;

const plainKey = (sku: unknown): string =>
  String(sku ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/**
 * Key a catalogue SKU is stored under. `capriKeyOf` carries the two shapes the
 * plain normalisation misses (the four "YC…" frames and "DI CAPRIO CAS"), so an
 * edit to YC21102 lands on the very row the cost sheet reads for it.
 */
export function frameCostKeyOf(sku: string): string {
  return capriKeyOf(sku);
}

/** The supplier list's row for a key, as a `FrameCostRow`; null when it has none. */
function listRow(key: string): FrameCostRow | null {
  const hit = CAPRI_BY_KEY.get(key);
  if (!hit) return null;
  return {
    sku: hit.key,
    model: hit.model,
    book_cents: hit.book_cents,
    cost_cents: hit.cost_cents,
    source: "supplier_list",
    updated_at: null,
    updated_by: null,
  };
}

/**
 * The row for a SKU: the stored one (looked up by its own spelling first, then
 * by the supplier's key), else the compiled list, else null. Pure.
 */
export function frameCostRowFrom(rows: ReadonlyMap<string, FrameCostRow>, sku: string): FrameCostRow | null {
  const plain = plainKey(sku);
  if (!plain) return null;
  const direct = rows.get(plain);
  if (direct) return direct;
  const key = frameCostKeyOf(sku);
  return rows.get(key) ?? listRow(key);
}

/** `cost_cents` for a SKU, or null when nothing knows it. Pure. */
export function frameCostCentsFrom(rows: ReadonlyMap<string, FrameCostRow>, sku: string): number | null {
  const row = frameCostRowFrom(rows, sku);
  return row ? row.cost_cents : null;
}

/** Validation of an edit as the panel sends it; a `reason` code or null. */
export function frameCostDenied(sku: unknown, costCents: unknown): string | null {
  if (typeof sku !== "string" || !plainKey(sku) || sku.length > 80) return "bad_sku";
  if (costCents === null) return null;
  const n = Number(costCents);
  // Cents, integer, and bounded: a frame that costs more than $10,000 is a typo.
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_000) return "bad_cost";
  return null;
}

// ── Process cache (so the pure math can stay synchronous) ────────────────────

const TTL_MS = 60_000;
const EMPTY: ReadonlyMap<string, FrameCostRow> = new Map();
let cache: { at: number; rows: Map<string, FrameCostRow>; loaded: boolean } | null = null;

/** Replace the cache with these rows (the loader and the tests). */
export function setFrameCostCache(rows: readonly FrameCostRow[]): void {
  cache = { at: Date.now(), rows: new Map(rows.map((r) => [r.sku, r])), loaded: true };
}

/** Drop the cache: after an edit, and between tests. */
export function clearFrameCostCache(): void {
  cache = null;
}

/** What the cache holds right now (empty before the first load). */
export function frameCostRows(): ReadonlyMap<string, FrameCostRow> {
  return cache?.rows ?? EMPTY;
}

/** True once the table has been read successfully at least once in this process. */
export function frameCostsLoaded(): boolean {
  return cache?.loaded === true;
}

/**
 * The default lookup of `computeCostSheet`. Synchronous and never throws.
 *
 * It answers only once the TABLE has been read: `store_frame_cost` is the
 * source of truth (the migration seeds it with the supplier's list and the
 * owner edits it there), and a process that could not read it — an
 * un-migrated database, a pure unit test — must behave exactly as the shop did
 * before this existed and let the cost RULES decide, instead of half of each
 * sale coming from one source and half from the other.
 *
 * Once the table has been read, a key it does not carry still falls back to
 * the compiled list (`frameCostCentsFrom`), so a model the next supplier list
 * adds is costed before anyone reseeds anything.
 */
export function frameCostCents(sku: string): number | null {
  return cache?.loaded ? frameCostCentsFrom(cache.rows, sku) : null;
}

const svc = (c: MedusaContainer) => c.resolve<StorePricingModuleService>(STORE_PRICING_MODULE);

function toRow(r: Record<string, unknown>): FrameCostRow {
  const source = r["source"] === "owner_edit" ? "owner_edit" : "supplier_list";
  const at = r["updated_at"];
  return {
    sku: String(r["sku"] ?? ""),
    model: String(r["supplier_model"] ?? r["sku"] ?? ""),
    book_cents: Math.round(Number(r["book_cents"]) || 0),
    cost_cents: Math.round(Number(r["cost_cents"]) || 0),
    source,
    updated_at: at ? new Date(String(at)).toISOString() : null,
    updated_by: (r["updated_by"] as string | null) ?? null,
  };
}

/** Every live row, sorted by model. Throws — the routes report the failure. */
export async function listFrameCosts(container: MedusaContainer): Promise<FrameCostRow[]> {
  const rows = (await svc(container).listStoreFrameCosts({}, { take: 5000 })) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => !r["deleted_at"])
    .map(toRow)
    .sort((a, b) => a.model.localeCompare(b.model) || a.sku.localeCompare(b.sku));
}

/**
 * Warm the cache if it is older than the TTL. Never throws: an un-migrated
 * table must not take a sale or a dashboard down — the lookup then falls back
 * to the compiled supplier list, which is what the shop used before the table
 * existed.
 */
export async function ensureFrameCostCache(container: MedusaContainer): Promise<void> {
  if (cache && Date.now() - cache.at < TTL_MS) return;
  try {
    setFrameCostCache(await listFrameCosts(container));
  } catch {
    // Keep whatever we had (possibly nothing) and try again after the TTL. A
    // failure never marks the cache as loaded: see `frameCostCents`.
    cache = { at: Date.now(), rows: cache?.rows ?? new Map(), loaded: cache?.loaded ?? false };
  }
}

/**
 * Set the owner's cost for one model, or (with `costCents` null) hand the model
 * back to the supplier's list.
 *
 *  - setting marks the row `owner_edit`, which is what makes the seeding
 *    migration and the next supplier list leave it alone;
 *  - clearing restores the list's `cost_cents` and marks the row
 *    `supplier_list` again, so it starts following the list once more. A model
 *    the list does not carry is cleared back to "cost unknown" by deleting the
 *    row (nothing else can answer for it, and 0 would be a lie).
 *
 * Audited by the caller's route with `cost.change`; returns the resulting row
 * (null when the row was removed).
 */
export async function setOwnerFrameCost(
  container: MedusaContainer,
  input: { sku: string; costCents: number | null },
  actorId: string | null
): Promise<{ row: FrameCostRow | null; before: FrameCostRow | null }> {
  const service = svc(container);
  const key = frameCostKeyOf(input.sku);
  const existing = (await service.listStoreFrameCosts({ sku: key } as never, { take: 1 })) as unknown as Record<
    string,
    unknown
  >[];
  const current = existing.find((r) => !r["deleted_at"]);
  const before = current ? toRow(current) : null;
  const fromList = listRow(key);

  if (input.costCents === null) {
    if (!current) {
      clearFrameCostCache();
      return { row: fromList, before };
    }
    if (!fromList) {
      // Nothing to fall back on: the row goes away and the model reads as
      // "cost unknown" again instead of pretending to cost nothing.
      await service.softDeleteStoreFrameCosts([String(current["id"])]);
      clearFrameCostCache();
      return { row: null, before };
    }
    await service.updateStoreFrameCosts([
      {
        id: current["id"],
        supplier_model: fromList.model,
        book_cents: fromList.book_cents,
        cost_cents: fromList.cost_cents,
        source: "supplier_list",
        updated_by: actorId,
      },
    ] as never);
    clearFrameCostCache();
    return { row: { ...fromList, updated_by: actorId }, before };
  }

  const cost = Math.round(input.costCents);
  const model = before?.model || fromList?.model || key;
  const book = before?.book_cents ?? fromList?.book_cents ?? 0;
  if (current) {
    await service.updateStoreFrameCosts([
      { id: current["id"], cost_cents: cost, source: "owner_edit", updated_by: actorId },
    ] as never);
  } else {
    await service.createStoreFrameCosts({
      sku: key,
      supplier_model: model,
      book_cents: book,
      cost_cents: cost,
      source: "owner_edit",
      updated_by: actorId,
    } as never);
  }
  clearFrameCostCache();
  return {
    row: { sku: key, model, book_cents: book, cost_cents: cost, source: "owner_edit", updated_at: new Date().toISOString(), updated_by: actorId },
    before,
  };
}

// ── The catalogue, so the panel can say what is still without a cost ─────────

export interface CatalogModel {
  product_id: string;
  /** The model's SKU as the catalogue writes it ("ML 8"). */
  sku: string;
  title: string;
  brand_slug: string;
  is_case: boolean;
  /** Selling price in cents; null when the model has none yet. */
  price_cents: number | null;
}

/**
 * Every published model with its SKU and selling price. Best effort: without a
 * database the panel simply shows no catalogue counts (and the sheet mirrors
 * only the cost side) rather than failing.
 */
export async function loadCatalogModels(container: MedusaContainer): Promise<CatalogModel[]> {
  const out: CatalogModel[] = [];
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const pageSize = 200;
    for (let skip = 0; skip < 5000; skip += pageSize) {
      const { data } = await query.graph({
        entity: "product",
        fields: ["id", "title", "handle", "metadata", "variants.sku", "variants.prices.amount", "variants.prices.currency_code"],
        filters: { status: "published" },
        pagination: { skip, take: pageSize },
      });
      const page = (data ?? []) as Array<Record<string, any>>;
      for (const p of page) {
        const variants = (p.variants ?? []) as Array<Record<string, any>>;
        // Prices in this shop are per MODEL (price-sync writes the same amount
        // on every variant), so the first USD price found is the model's.
        let price: number | null = null;
        for (const v of variants) {
          const usd = ((v.prices ?? []) as Array<Record<string, any>>).find((x) => x.currency_code === "usd");
          if (usd) {
            price = Math.round(Number(usd.amount) * 100);
            break;
          }
        }
        const brand_slug = brandOf(p.metadata as Record<string, unknown> | null);
        out.push({
          product_id: String(p.id),
          sku: String(variants.find((v) => v.sku)?.sku ?? p.handle ?? p.title ?? ""),
          title: String(p.title ?? ""),
          brand_slug,
          is_case: brand_slug === "case" || brand_slug === "cases",
          price_cents: price,
        });
      }
      if (page.length < pageSize) break;
    }
  } catch (error) {
    container
      .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
      .warn(`[frame-cost] catalog unavailable: ${(error as Error).message}`);
    return [];
  }
  return out;
}

/** Models the panel lists as still without a cost (capped; the count is exact). */
export const MISSING_SAMPLE = 100;

export interface FrameCostSummary {
  /** Rows in the table. */
  rows: number;
  supplier_rows: number;
  owner_edited: number;
  /** Published models seen in the catalogue (0 when it could not be read). */
  catalog_models: number;
  /** Catalogue models whose cost is known. */
  with_cost: number;
  /** Catalogue models with NO cost: these read as "cost unknown", never as 0. */
  without_cost: number;
  /** The first `MISSING_SAMPLE` of them, so the owner can go and type them. */
  missing: Array<{ sku: string; title: string; brand_slug: string }>;
}

/** Counts the panel shows above the list. Pure. */
export function summarizeFrameCosts(rows: readonly FrameCostRow[], catalog: readonly CatalogModel[]): FrameCostSummary {
  const byKey = new Map(rows.map((r) => [r.sku, r]));
  const missing: FrameCostSummary["missing"] = [];
  let with_cost = 0;
  for (const m of catalog) {
    if (frameCostCentsFrom(byKey, m.sku) !== null) with_cost++;
    else {
      if (missing.length < MISSING_SAMPLE) missing.push({ sku: m.sku, title: m.title, brand_slug: m.brand_slug });
    }
  }
  return {
    rows: rows.length,
    supplier_rows: rows.filter((r) => r.source === "supplier_list").length,
    owner_edited: rows.filter((r) => r.source === "owner_edit").length,
    catalog_models: catalog.length,
    with_cost,
    without_cost: catalog.length - with_cost,
    missing,
  };
}

/**
 * The six fields of the API contract, and only those: `updated_by` belongs in
 * the audit log, not in a payload the panel caches and the sheet mirrors.
 */
export function frameCostView(row: FrameCostRow): Record<string, unknown> {
  return {
    sku: row.sku,
    model: row.model,
    book_cents: row.book_cents,
    cost_cents: row.cost_cents,
    source: row.source,
    updated_at: row.updated_at,
  };
}

/** Audit payload of an edit — the figures only, never a whole row. */
export function frameCostAudit(row: FrameCostRow | null): Record<string, unknown> | null {
  return row ? { sku: row.sku, cost_cents: row.cost_cents, source: row.source } : null;
}
