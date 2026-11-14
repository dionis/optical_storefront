import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { CAPRI_BY_KEY, capriKeyOf } from "../modules/store-pricing/capri-price-list-2026";
import { CAPRI_PREV_BY_KEY } from "../modules/store-pricing/capri-price-list-prev";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import type StorePricingModuleService from "../modules/store-pricing/service";
import { brandOf } from "./store-assortment";
import { masterLinePrice, storeLinePrice, type MasterLinePrice, type PriceRuleLike } from "./store-pricing";

/**
 * What the shop PAYS for a frame or case model — the supplier's figure, the one
 * the owner typed over it (`store_frame_cost`, see
 * modules/store-pricing/models/frame-cost.ts), and the one ONE STORE pays when
 * it does not pay what the chain pays (`store_frame_cost_variation`, see
 * models/frame-cost-variation.ts).
 *
 * The owner: "cost and price must appear in every commercial view, and they
 * must be editable, so the accounting is 100 % reliable", and then: «los costos
 * se aplican a todas las tiendas, pero cada tienda maneja sus costos por
 * separado». Three consequences live in this file:
 *
 *  1. ONE resolution order, used by the panel, the cost sheet and the sheet
 *     mirror alike:
 *
 *        the STORE's variation          (that store pays this)
 *      → the master row                 (the owner's edit beats nothing,
 *                                        because an edit IS the row)
 *      → the supplier list compiled into the build
 *      → NULL.
 *
 *     Never 0: a silent zero turns a case with no known cost into a 100 %
 *     margin, which is exactly the lie this work removes. A null is reported
 *     as "cost unknown" (`undefined_cost` / `missing_cost`).
 *
 *  2. The per-store layer is the SAME shape the panel already uses for prices
 *     (`lens_store_price`, lib/pricing-overview.ts): a row exists only where a
 *     store differs, "Todas las tiendas" edits the master, and a model with no
 *     row of its own is shown as «Heredado». Removing the row is how a store
 *     goes back to inheriting.
 *
 *  3. The lookup `lib/costing.ts` needs is SYNCHRONOUS (`computeCostSheet` is
 *     pure and is called per sale line, thousands of times in one dashboard
 *     query), so both tables are held in a short-lived process cache refreshed
 *     by `ensureFrameCostCache` — which `listCostRules` calls, i.e. everything
 *     that computes a cost sheet already warms it. ONE warm-up carries EVERY
 *     store's variations (6 stores × ~600 models at the very most), because a
 *     sheet is computed per order and each order belongs to a different store:
 *     a per-store load would be a query inside the loop. With an empty or stale
 *     cache the answer degrades to the compiled supplier list, never to zero,
 *     and never to another store's figure.
 *
 * v2 (7-nov-2026, docs/PRICE-MATRIX.md): a model is matched to its cost by
 * MODEL first (the product title, "DC 50" → DC50), then by every colour's
 * SKU (also cut at word boundaries: the scraper's `dc-50-di-caprio-grey`),
 * then by UPC — `frameCostCandidates`. A caller that only holds a SKU
 * (costing, the sales panel, the store P&L: `frameCostCents(sku, storeId)`)
 * gets the model from the catalogue aliases the cache loads with the costs.
 * The supplier lists: 2026 first, then the previous one
 * (`capri-price-list-prev.ts`, source `supplier_list_prev`), then nothing.
 */

/**
 * `supplier_list_prev` (v2, 7-nov-2026): the figure comes from the PREVIOUS
 * supplier list (`capri-price-list-prev.ts`) because the 2026 list does not
 * carry the model. A new list refreshes both kinds of supplier rows; neither
 * ever touches `owner_edit`.
 */
export const FRAME_COST_SOURCES = ["supplier_list", "supplier_list_prev", "owner_edit"] as const;
export type FrameCostSource = (typeof FRAME_COST_SOURCES)[number];
export const isFrameCostSource = (v: unknown): v is FrameCostSource => FRAME_COST_SOURCES.includes(v as FrameCostSource);

/**
 * WHERE an effective cost comes from, in precedence order. `source` above says
 * what the MASTER holds; this says what actually answered for the scope that
 * was asked about, which is the difference between "the chain pays this" and
 * "this store pays this".
 */
export const FRAME_COST_ORIGINS = ["store_variation", "owner_edit", "supplier_list", "supplier_list_prev"] as const;
export type FrameCostOrigin = (typeof FRAME_COST_ORIGINS)[number];

export interface FrameCostRow {
  /** Normalised key (A-Z0-9) the catalogue model resolves to. */
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

/** One store's own cost for one model. Its existence IS the variation. */
export interface FrameCostVariationRow {
  establishment_id: string;
  /** Normalised key (A-Z0-9), the same one the master is stored under. */
  sku: string;
  cost_cents: number;
  updated_at: string | null;
  updated_by: string | null;
}

/** Variations indexed store → normalised SKU → row, which is how the cache holds them. */
export type FrameCostVariationIndex = ReadonlyMap<string, ReadonlyMap<string, FrameCostVariationRow>>;

/**
 * The synchronous lookup `computeCostSheet` takes: cents, or null when
 * unknown. `storeId` is the store the sale belongs to — without it the answer
 * is the master, which is what the chain-wide views want. `model` (the product
 * title, v2) is tried BEFORE the SKU when the caller has it; without it the
 * cache's catalogue aliases supply it (see `frameCostCents`).
 */
export type FrameCostLookup = (sku: string, storeId?: string | null, model?: string | null) => number | null;

const plainKey = (sku: unknown): string =>
  String(sku ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const EMPTY_ROWS: ReadonlyMap<string, FrameCostRow> = new Map();

/**
 * Key a catalogue SKU is stored under. `capriKeyOf` carries the two shapes the
 * plain normalisation misses (the four "YC…" frames and "DI CAPRIO CAS"), so an
 * edit to YC21102 lands on the very row the cost sheet reads for it.
 */
export function frameCostKeyOf(sku: string): string {
  return capriKeyOf(sku);
}

// ── Which supplier key a catalogue model is (v2: model first) ────────────────
//
// Until 7-nov-2026 the cost was looked up by the variant SKU alone. In staging
// the scraper invents SKUs when Capri publishes no UPC — `<handle>-<colour>`,
// e.g. `dc-50-di-caprio-grey` — so EVERY model read «falta». The supplier's
// lists are keyed by MODEL ("DC 50" → DC50), which is the product's title, so
// the model is now asked first and the SKUs (and the UPCs) only after it.

/**
 * What names a catalogue model for its cost: its title (the model, "DC 50"),
 * every colour's SKU, every colour's UPC. Any of them may be missing; a bare
 * string is a SKU (the shape every caller used before v2).
 */
export interface FrameCostRef {
  model?: string | null;
  skus?: ReadonlyArray<string | null | undefined>;
  upcs?: ReadonlyArray<string | null | undefined>;
}
export type FrameCostTarget = string | FrameCostRef;

/**
 * Words a catalogue title or a scraper SKU may carry around the model that the
 * supplier's list never prints ("Grande GR 801", "dc-50-di-caprio-grey"). Only
 * stripped as a whole prefix or suffix of the normalised key, and only tried
 * after the key as written, so "SIMPLYLITE CASE" still matches itself first.
 */
export const FRAME_COST_BRAND_WORDS = [
  "DICAPRIO",
  "FLEXURE",
  "MILLENNIAL",
  "MILLENIAL",
  "PEACHTREE",
  "TRENDY",
  "FOURYOU",
  "4U",
  "GRANDE",
  "SIMPLYLITE",
  "PRORX",
] as const;

/** The spellings of ONE string, most literal first. */
function keySpellings(raw: unknown): string[] {
  const plain = plainKey(raw);
  if (!plain) return [];
  const out = [plain];
  const add = (k: string) => {
    if (k.length >= 2 && !out.includes(k)) out.push(k);
  };
  // The two catalogue shapes `capriKeyOf` knows: YC21102 → 21102, DI CAPRIO CASE → DI CAPRIO CAS.
  if (plain.startsWith("YC")) add(plain.slice(2));
  if (plain === "DICAPRIOCASE") add("DICAPRIOCAS");
  for (const w of FRAME_COST_BRAND_WORDS) {
    if (plain.length > w.length + 1 && plain.startsWith(w)) add(plain.slice(w.length));
    if (plain.length > w.length + 1 && plain.endsWith(w)) add(plain.slice(0, plain.length - w.length));
  }
  return out;
}

/**
 * A slug-like SKU (`dc-50-di-caprio-grey`, `T 35-crystal-black`) cut at every
 * word boundary, longest first: DC50DICAPRIO, DC50DI, DC50, DC. Whole words
 * only, so `dc-50-…` can never become DC501. Empty for a one-word SKU.
 */
function slugPrefixes(raw: unknown): string[] {
  const words = String(raw ?? "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let n = words.length - 1; n >= 1; n--) {
    const k = plainKey(words.slice(0, n).join(""));
    if (k.length >= 2 && !out.includes(k)) out.push(k);
  }
  return out;
}

const asRef = (target: FrameCostTarget): FrameCostRef => (typeof target === "string" ? { skus: [target] } : target ?? {});

/**
 * Every key a model could be stored under, in the order they are tried:
 *
 *   1. the MODEL (title) as written, then without a brand word around it;
 *   2. each SKU as written (and its YC / brand-word spellings);
 *   3. each SKU cut at word boundaries (the scraper's `<handle>-<colour>`);
 *   4. each UPC.
 *
 * Pure, deterministic, no duplicates.
 */
export function frameCostCandidates(target: FrameCostTarget): string[] {
  const ref = asRef(target);
  const out: string[] = [];
  const push = (keys: string[]) => {
    for (const k of keys) if (!out.includes(k)) out.push(k);
  };
  push(keySpellings(ref.model));
  const skus = (ref.skus ?? []).filter((s): s is string => typeof s === "string" && s.trim() !== "");
  for (const s of skus) push(keySpellings(s));
  for (const s of skus) push(slugPrefixes(s));
  for (const u of ref.upcs ?? []) push(plainKey(u) ? [plainKey(u)] : []);
  return out;
}

/** A supplier list's row for a key (2026 first, then the previous list); null when neither has one. */
function listRow(key: string): FrameCostRow | null {
  const hit = CAPRI_BY_KEY.get(key);
  if (hit) {
    return { sku: hit.key, model: hit.model, book_cents: hit.book_cents, cost_cents: hit.cost_cents, source: "supplier_list", updated_at: null, updated_by: null };
  }
  const prev = CAPRI_PREV_BY_KEY.get(key);
  if (prev && prev.wholesale_cents != null) {
    return { sku: prev.key, model: prev.model, book_cents: 0, cost_cents: prev.wholesale_cents, source: "supplier_list_prev", updated_at: null, updated_by: null };
  }
  return null;
}

/** The compiled lists' figure for a key (2026 → previous → none), as a row. Pure. */
export function supplierListRow(key: string): FrameCostRow | null {
  return listRow(plainKey(key));
}

/**
 * The MASTER row for a model, in three passes over `frameCostCandidates`:
 *
 *   1. a row the OWNER edited, under any of the model's keys (his figure beats
 *      the lists wherever the panel saved it — older screens saved under the
 *      SKU spelling, v2 under the model);
 *   2. any stored row (the seeded supplier rows), model key first;
 *   3. the compiled lists (2026, then the previous one).
 *
 * Null when nothing knows the model — never a zero. Pure.
 */
export function frameCostRowFrom(rows: ReadonlyMap<string, FrameCostRow>, target: FrameCostTarget): FrameCostRow | null {
  const keys = frameCostCandidates(target);
  if (!keys.length) return null;
  for (const k of keys) {
    const r = rows.get(k);
    if (r && r.source === "owner_edit") return r;
  }
  for (const k of keys) {
    const r = rows.get(k);
    if (r) return r;
  }
  for (const k of keys) {
    const r = listRow(k);
    if (r) return r;
  }
  return null;
}

/**
 * The row stored (or listed) under THIS spelling only — the SKU as written,
 * then its supplier key — with none of the model / word-boundary candidates.
 * What tells «this colour's SKU IS the model's key» apart from «this SKU
 * merely starts with it» (lib/price-matrix.ts `modelSkuOf`). Pure.
 */
export function frameCostRowExact(rows: ReadonlyMap<string, FrameCostRow>, sku: string): FrameCostRow | null {
  const plain = plainKey(sku);
  if (!plain) return null;
  const key = frameCostKeyOf(sku);
  return rows.get(plain) ?? rows.get(key) ?? listRow(key);
}

/** The master `cost_cents` for a model, or null when nothing knows it. Pure. */
export function frameCostCentsFrom(rows: ReadonlyMap<string, FrameCostRow>, target: FrameCostTarget): number | null {
  const row = frameCostRowFrom(rows, target);
  return row ? row.cost_cents : null;
}

/**
 * The key a cost of this model is (or would be) stored under: the key of the
 * row that answers for it today, else the first key a supplier list knows,
 * else the model as written (else the first SKU). What a write uses, so an
 * edit lands on the very row every reader resolves. Pure.
 */
export function frameCostKeyFor(target: FrameCostTarget, rows: ReadonlyMap<string, FrameCostRow> = EMPTY_ROWS): string {
  const hit = frameCostRowFrom(rows, target);
  if (hit) return hit.sku;
  const keys = frameCostCandidates(target);
  return keys[0] ?? "";
}

/**
 * A store's own row for a model, with the same candidate keys as the master so
 * a variation typed from one screen is found from every other. Pure; null when
 * that store inherits.
 */
export function frameCostVariationFrom(
  variations: FrameCostVariationIndex,
  target: FrameCostTarget,
  storeId: string | null | undefined
): FrameCostVariationRow | null {
  if (!storeId) return null;
  const own = variations.get(storeId);
  if (!own || own.size === 0) return null;
  for (const k of frameCostCandidates(target)) {
    const hit = own.get(k);
    if (hit) return hit;
  }
  return null;
}

/** An effective cost together with the master it is (or is not) a variation of. */
export interface ResolvedFrameCost {
  /** Normalised key the figures are stored under. */
  sku: string;
  /** Model as the supplier prints it, or the key when nothing names it. */
  model: string;
  book_cents: number;
  /** What the asked scope pays, in cents. Never 0 by default — see the module doc. */
  cost_cents: number;
  /** Which of the layers answered. */
  origin: FrameCostOrigin;
  /** The chain's figure, kept even when a store overrides it, so the panel can show both. */
  master_cost_cents: number | null;
  master_source: FrameCostSource | null;
  /** True when a store was asked about and it has no variation of its own. */
  inherited: boolean;
  /** Last change of whichever layer answered. */
  updated_at: string | null;
}

/**
 * THE resolution, in one pure function: the store's variation, then the master
 * (the owner's edit or a supplier list), then nothing. Returns null when no
 * layer knows the model — never a zero.
 */
export function resolveFrameCost(
  rows: ReadonlyMap<string, FrameCostRow>,
  variations: FrameCostVariationIndex,
  target: FrameCostTarget,
  storeId: string | null | undefined
): ResolvedFrameCost | null {
  const master = frameCostRowFrom(rows, target);
  const own = frameCostVariationFrom(variations, target, storeId);
  if (!master && !own) return null;
  const key = own?.sku ?? master?.sku ?? frameCostCandidates(target)[0] ?? "";
  const base = {
    sku: key,
    model: master?.model ?? key,
    book_cents: master?.book_cents ?? 0,
    master_cost_cents: master ? master.cost_cents : null,
    master_source: master ? master.source : null,
  };
  if (own) {
    return { ...base, cost_cents: own.cost_cents, origin: "store_variation", inherited: false, updated_at: own.updated_at };
  }
  // `master` is non-null here: the early return above covers the other case.
  const row = master as FrameCostRow;
  return {
    ...base,
    cost_cents: row.cost_cents,
    origin: row.source,
    inherited: Boolean(storeId),
    updated_at: row.updated_at,
  };
}

/**
 * `cost_cents` for a model in a store (or chain-wide with no store), or null
 * when nothing knows it. Pure, and the function every margin goes through.
 */
export function frameCostCentsFor(
  rows: ReadonlyMap<string, FrameCostRow>,
  variations: FrameCostVariationIndex,
  target: FrameCostTarget,
  storeId: string | null | undefined
): number | null {
  const resolved = resolveFrameCost(rows, variations, target, storeId);
  return resolved ? resolved.cost_cents : null;
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
const EMPTY_STORES: FrameCostVariationIndex = new Map();
let cache: {
  at: number;
  rows: Map<string, FrameCostRow>;
  /** store → normalised SKU → that store's own figure. */
  stores: Map<string, Map<string, FrameCostVariationRow>>;
  /**
   * Catalogue aliases: normalised variant SKU / UPC → the model (product
   * title). What lets a caller that only holds a sale's SKU
   * (`sale_fact.sku`, a board order's line) still be costed by MODEL — the
   * store P&L, the sales panel and the costs tab pass a SKU and nothing else.
   */
  aliases: Map<string, string>;
  loaded: boolean;
} | null = null;

/** Group a flat list of variations the way the cache (and the panel) reads them. */
export function indexFrameCostVariations(
  rows: readonly FrameCostVariationRow[]
): Map<string, Map<string, FrameCostVariationRow>> {
  const out = new Map<string, Map<string, FrameCostVariationRow>>();
  for (const r of rows) {
    if (!r.establishment_id || !r.sku) continue;
    const bucket = out.get(r.establishment_id);
    if (bucket) bucket.set(r.sku, r);
    else out.set(r.establishment_id, new Map([[r.sku, r]]));
  }
  return out;
}

/** Replace the cache with these rows (the loader and the tests). */
export function setFrameCostCache(
  rows: readonly FrameCostRow[],
  variations: readonly FrameCostVariationRow[] = [],
  aliases: ReadonlyMap<string, string> | ReadonlyArray<CatalogAlias> = new Map()
): void {
  cache = {
    at: Date.now(),
    rows: new Map(rows.map((r) => [r.sku, r])),
    stores: indexFrameCostVariations(variations),
    aliases: Array.isArray(aliases) ? indexCatalogAliases(aliases as ReadonlyArray<CatalogAlias>) : new Map(aliases as ReadonlyMap<string, string>),
    loaded: true,
  };
}

/** One colour of the catalogue as the alias loader reads it. */
export interface CatalogAlias {
  /** The product title (the model). */
  title: string;
  sku?: string | null;
  upc?: string | null;
}

/**
 * Normalised SKU / UPC → model. A code two products share (it should not
 * happen) keeps the first, like the supplier list does with a duplicate key.
 * Pure.
 */
export function indexCatalogAliases(rows: ReadonlyArray<CatalogAlias>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const title = String(r.title ?? "").trim();
    if (!title) continue;
    for (const code of [r.sku, r.upc]) {
      const k = plainKey(code);
      if (k && !out.has(k)) out.set(k, title);
    }
  }
  return out;
}

/** The model the catalogue gives this SKU (or UPC), when the cache holds the catalogue. */
export function catalogModelOfSku(sku: string | null | undefined): string | null {
  const k = plainKey(sku);
  return k ? cache?.aliases.get(k) ?? null : null;
}

/** Drop the cache: after an edit, and between tests. */
export function clearFrameCostCache(): void {
  cache = null;
}

/** What the cache holds right now (empty before the first load). */
export function frameCostRows(): ReadonlyMap<string, FrameCostRow> {
  return cache?.rows ?? EMPTY;
}

/** The per-store variations the cache holds right now (empty before the first load). */
export function frameCostVariations(): FrameCostVariationIndex {
  return cache?.stores ?? EMPTY_STORES;
}

/** True once the table has been read successfully at least once in this process. */
export function frameCostsLoaded(): boolean {
  return cache?.loaded === true;
}

/**
 * The default lookup of `computeCostSheet`. Synchronous and never throws.
 *
 * It answers only once the TABLES have been read: `store_frame_cost` (plus
 * `store_frame_cost_variation`) is the source of truth, and a process that
 * could not read it — an un-migrated database, a pure unit test — must behave
 * exactly as the shop did before this existed and let the cost RULES decide,
 * instead of half of each sale coming from one source and half from the other.
 *
 * Once the tables have been read, `storeId` decides which figure answers: that
 * store's variation if it has one, otherwise the master. A key the master table
 * does not carry still falls back to the compiled list, so a model the next
 * supplier list adds is costed before anyone reseeds anything.
 */
export function frameCostCents(sku: string, storeId?: string | null, model?: string | null): number | null {
  if (!cache?.loaded) return null;
  // v2: the MODEL first — the caller's (the product title) or, when it only
  // has the SKU, the one the catalogue gives that SKU — then the SKU itself.
  const name = model && String(model).trim() ? model : catalogModelOfSku(sku);
  return frameCostCentsFor(cache.rows, cache.stores, { model: name, skus: [sku] }, storeId);
}

const svc = (c: MedusaContainer) => c.resolve<StorePricingModuleService>(STORE_PRICING_MODULE);

function toRow(r: Record<string, unknown>): FrameCostRow {
  const source: FrameCostSource = isFrameCostSource(r["source"]) ? r["source"] : "supplier_list";
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

function toVariation(r: Record<string, unknown>): FrameCostVariationRow {
  const at = r["updated_at"];
  return {
    establishment_id: String(r["establishment_id"] ?? ""),
    sku: String(r["sku"] ?? ""),
    cost_cents: Math.round(Number(r["cost_cents"]) || 0),
    updated_at: at ? new Date(String(at)).toISOString() : null,
    updated_by: (r["updated_by"] as string | null) ?? null,
  };
}

/** Every live master row, sorted by model. Throws — the routes report the failure. */
export async function listFrameCosts(container: MedusaContainer): Promise<FrameCostRow[]> {
  const rows = (await svc(container).listStoreFrameCosts({}, { take: 5000 })) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => !r["deleted_at"])
    .map(toRow)
    .sort((a, b) => a.model.localeCompare(b.model) || a.sku.localeCompare(b.sku));
}

/**
 * Every live variation, of one store or of all of them. Throws — the routes
 * report the failure; `ensureFrameCostCache` swallows it on purpose.
 *
 * The ceiling is deliberate: six stores and ~600 models is 3,600 rows at the
 * very most, and in practice a store varies a handful of them.
 */
export async function listFrameCostVariations(
  container: MedusaContainer,
  storeId?: string | null
): Promise<FrameCostVariationRow[]> {
  const filter = storeId ? ({ establishment_id: storeId } as never) : ({} as never);
  const rows = (await svc(container).listStoreFrameCostVariations(filter, {
    take: 20000,
  })) as unknown as Record<string, unknown>[];
  return rows.filter((r) => !r["deleted_at"]).map(toVariation);
}

/**
 * Warm the cache if it is older than the TTL — the master AND every store's
 * variations, in one pass. Never throws: an un-migrated table must not take a
 * sale or a dashboard down.
 *
 * A failure on the MASTER leaves the cache unloaded, so the lookup answers
 * nothing and the cost rules keep deciding (see `frameCostCents`). A failure on
 * the VARIATIONS keeps whatever variations we had and still marks the master
 * loaded: every store then reads the chain's figure, which is what it paid
 * before this layer existed — never another store's.
 */
export async function ensureFrameCostCache(container: MedusaContainer): Promise<void> {
  if (cache && Date.now() - cache.at < TTL_MS) return;
  let rows: Map<string, FrameCostRow>;
  let loaded: boolean;
  try {
    rows = new Map((await listFrameCosts(container)).map((r) => [r.sku, r]));
    loaded = true;
  } catch {
    // Keep whatever we had (possibly nothing) and try again after the TTL. A
    // failure never marks the cache as loaded: see `frameCostCents`.
    rows = cache?.rows ?? new Map();
    loaded = cache?.loaded ?? false;
  }
  let stores: Map<string, Map<string, FrameCostVariationRow>>;
  try {
    stores = indexFrameCostVariations(await listFrameCostVariations(container));
  } catch {
    stores = cache?.stores ?? new Map();
  }
  let aliases: Map<string, string>;
  try {
    aliases = indexCatalogAliases(await loadCatalogAliases(container));
  } catch {
    // No catalogue (a stubbed container, a database without Medusa's tables):
    // the SKU alone still resolves through `frameCostCandidates`.
    aliases = cache?.aliases ?? new Map();
  }
  cache = { at: Date.now(), rows, stores, aliases, loaded };
}

/**
 * Every live colour of the catalogue with its model: ONE query (~600 models ×
 * 3 colours), refreshed with the cost cache. Throws — the caller swallows it.
 */
export async function loadCatalogAliases(container: MedusaContainer): Promise<CatalogAlias[]> {
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const rows = (await pg("product_variant as v")
    .join("product as p", "p.id", "v.product_id")
    .whereNull("v.deleted_at")
    .whereNull("p.deleted_at")
    .select("p.title", "v.sku", pg.raw(`v.metadata->>'upc' as upc`))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ title: String(r["title"] ?? ""), sku: (r["sku"] as string | null) ?? null, upc: (r["upc"] as string | null) ?? null }));
}

/**
 * Set the owner's MASTER cost for one model, or (with `costCents` null) hand the
 * model back to the supplier's list. This is the chain-wide figure: every store
 * without a variation of its own follows it.
 *
 *  - setting marks the row `owner_edit`, which is what makes the seeding
 *    migration and the next supplier list leave it alone;
 *  - clearing restores the list's `cost_cents` and marks the row
 *    `supplier_list` (or `supplier_list_prev` when only the previous list
 *    has it) again, so it starts following the list once more. A model
 *    the list does not carry is cleared back to "cost unknown" by deleting the
 *    row (nothing else can answer for it, and 0 would be a lie).
 *
 * A store's own variation is NOT touched either way: the owner moving the
 * chain's cost is not the owner moving a store's.
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
        // The 2026 list's, or the previous list's when only that one has it.
        source: fromList.source,
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

/**
 * Set ONE STORE's own cost for one model, or (with `costCents` null) remove the
 * variation so the store inherits the master again.
 *
 * Removing is a real delete, not a zero and not a row marked somehow: the
 * absence of a row IS "this store follows the chain", which is the same thing
 * `upsertStoreLensPrice` does for a lens cell, and it is why reading back after
 * a removal gives the master's figure instead of a 0 margin.
 *
 * Audited by the caller's route with `cost.change` and the store on the event;
 * returns the resulting variation (null when it was removed).
 */
export async function setStoreFrameCost(
  container: MedusaContainer,
  input: { storeId: string; sku: string; costCents: number | null },
  actorId: string | null
): Promise<{ row: FrameCostVariationRow | null; before: FrameCostVariationRow | null }> {
  const service = svc(container);
  const key = frameCostKeyOf(input.sku);
  const existing = (await service.listStoreFrameCostVariations(
    { establishment_id: input.storeId, sku: key } as never,
    { take: 1 }
  )) as unknown as Record<string, unknown>[];
  const current = existing.find((r) => !r["deleted_at"]);
  const before = current ? toVariation(current) : null;

  if (input.costCents === null) {
    if (current) await service.deleteStoreFrameCostVariations([String(current["id"])]);
    clearFrameCostCache();
    return { row: null, before };
  }

  const cost = Math.round(input.costCents);
  if (current) {
    await service.updateStoreFrameCostVariations([
      { id: current["id"], cost_cents: cost, updated_by: actorId },
    ] as never);
  } else {
    await service.createStoreFrameCostVariations({
      establishment_id: input.storeId,
      sku: key,
      cost_cents: cost,
      updated_by: actorId,
    } as never);
  }
  clearFrameCostCache();
  return {
    row: {
      establishment_id: input.storeId,
      sku: key,
      cost_cents: cost,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    },
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
  /**
   * The brand as the product names it (`metadata.brand`). The known brands have
   * their own name list; a brand the owner adds from «Productos y precios» only
   * has this one, so without it the sheet would print the slug.
   */
  brand_name?: string | null;
  is_case: boolean;
  /** Selling price in cents; null when the model has none yet. */
  price_cents: number | null;
  /** v2, optional: every colour's SKU, so the cost is found by model, then by any SKU. */
  skus?: string[];
  /** v2, optional: every colour's UPC (`metadata.upc_by_color`). */
  upcs?: string[];
}

/**
 * How a catalogue model names itself for its cost (v2): the title is the
 * MODEL ("DC 50" → DC50), then every colour's SKU, then the UPCs. Pure.
 */
export function costRefOf(m: Pick<CatalogModel, "title" | "sku" | "skus" | "upcs">): FrameCostRef {
  const skus = m.skus?.length ? (m.sku && !m.skus.includes(m.sku) ? [m.sku, ...m.skus] : m.skus) : [m.sku];
  return { model: m.title, skus, upcs: m.upcs ?? [] };
}

/** The UPCs a product's metadata carries (`upc_by_color`, the scraper's). Pure. */
export function upcsOf(metadata: Record<string, unknown> | null | undefined): string[] {
  const raw = metadata?.["upc_by_color"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.values(raw as Record<string, unknown>).filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/**
 * Every published model with its SKU and selling price. Best effort: without a
 * database the panel simply shows no catalogue counts (and the sheet mirrors
 * only the cost side) rather than failing.
 */
export async function loadCatalogModels(container: MedusaContainer, opts: { drafts?: boolean } = {}): Promise<CatalogModel[]> {
  const out: CatalogModel[] = [];
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const pageSize = 200;
    for (let skip = 0; skip < 5000; skip += pageSize) {
      const { data } = await query.graph({
        entity: "product",
        fields: ["id", "title", "handle", "metadata", "variants.sku", "variants.prices.amount", "variants.prices.currency_code"],
        // `drafts`: a model not yet on sale is priced too, so it is right the day it is published.
        filters: { status: opts.drafts ? ["published", "draft"] : "published" },
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
          skus: variants.map((v) => v.sku).filter((x): x is string => typeof x === "string" && x !== ""),
          upcs: upcsOf(p.metadata as Record<string, unknown> | null),
          title: String(p.title ?? ""),
          brand_slug,
          brand_name: typeof (p.metadata as Record<string, unknown> | null)?.["brand"] === "string" ? String((p.metadata as Record<string, unknown>)["brand"]) : null,
          // Same word as the till (lib/price-matrix.ts metadataSaysCase): the brand or metadata.kind.
          is_case: brand_slug === "case" || brand_slug === "cases" || (p.metadata as Record<string, unknown> | null)?.["kind"] === "case",
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
  /** Rows in the master table. */
  rows: number;
  supplier_rows: number;
  owner_edited: number;
  /** Variations of the store asked about (0 with no store, or when it has none). */
  store_variations: number;
  /** Published models seen in the catalogue (0 when it could not be read). */
  catalog_models: number;
  /** Catalogue models whose cost is known FOR THE SCOPE ASKED ABOUT. */
  with_cost: number;
  /** Catalogue models with NO cost: these read as "cost unknown", never as 0. */
  without_cost: number;
  /** The first `MISSING_SAMPLE` of them, so the owner can go and type them. */
  missing: Array<{ sku: string; title: string; brand_slug: string }>;
}

/**
 * Counts the panel shows above the list. Pure. With a `storeId` the coverage is
 * that store's (its variations plus everything it inherits), which is the only
 * number that answers "does MY shop have every cost?".
 */
export function summarizeFrameCosts(
  rows: readonly FrameCostRow[],
  catalog: readonly CatalogModel[],
  variations: FrameCostVariationIndex = EMPTY_STORES,
  storeId: string | null = null
): FrameCostSummary {
  const byKey = new Map(rows.map((r) => [r.sku, r]));
  const missing: FrameCostSummary["missing"] = [];
  let with_cost = 0;
  for (const m of catalog) {
    if (frameCostCentsFor(byKey, variations, costRefOf(m), storeId) !== null) with_cost++;
    else {
      if (missing.length < MISSING_SAMPLE) missing.push({ sku: m.sku, title: m.title, brand_slug: m.brand_slug });
    }
  }
  return {
    rows: rows.length,
    supplier_rows: rows.filter((r) => r.source === "supplier_list").length,
    owner_edited: rows.filter((r) => r.source === "owner_edit").length,
    store_variations: storeId ? variations.get(storeId)?.size ?? 0 : 0,
    catalog_models: catalog.length,
    with_cost,
    without_cost: catalog.length - with_cost,
    missing,
  };
}

/**
 * The six fields of the MASTER API contract, and only those: `updated_by`
 * belongs in the audit log, not in a payload the panel caches and the sheet
 * mirrors.
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

/**
 * One row of `GET /admin/pricing/frames/costs`, resolved for the scope asked
 * about. A strict superset of `frameCostView`:
 *
 *   `cost_cents`  what the asked scope pays (the store's figure, or the master)
 *   `origin`      which layer that figure came from
 *   `source`      what the MASTER holds — never re-labelled by a variation, so
 *                 "this came from the supplier's list" keeps meaning that
 *   `master_cost_cents`  the chain's figure, so the panel shows both
 *   `inherited`   true when a store was asked about and has no figure of its own
 *
 * With no store asked about, `origin` equals `source`, `master_cost_cents`
 * equals `cost_cents` and `inherited` is false — which is exactly the response
 * this route gave before the per-store layer existed, plus four fields.
 */
export function frameCostStoreView(resolved: ResolvedFrameCost): Record<string, unknown> {
  return {
    sku: resolved.sku,
    model: resolved.model,
    book_cents: resolved.book_cents,
    cost_cents: resolved.cost_cents,
    origin: resolved.origin,
    source: resolved.master_source,
    master_cost_cents: resolved.master_cost_cents,
    inherited: resolved.inherited,
    updated_at: resolved.updated_at,
  };
}

/**
 * Every row the panel lists for a scope: each master row resolved for that
 * store, plus any model the store varies that the master does not carry (a
 * variation typed on a model a newer supplier list will bring). Sorted by model
 * the way `listFrameCosts` sorts.
 */
export function frameCostStoreRows(
  rows: readonly FrameCostRow[],
  variations: FrameCostVariationIndex,
  storeId: string | null
): ResolvedFrameCost[] {
  const byKey = new Map(rows.map((r) => [r.sku, r]));
  const keys = rows.map((r) => r.sku);
  const seen = new Set(keys);
  if (storeId) {
    for (const key of variations.get(storeId)?.keys() ?? []) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const out: ResolvedFrameCost[] = [];
  for (const key of keys) {
    const resolved = resolveFrameCost(byKey, variations, key, storeId);
    if (resolved) out.push(resolved);
  }
  return out.sort((a, b) => a.model.localeCompare(b.model) || a.sku.localeCompare(b.sku));
}

// ── Cost next to price: the selling price per model, by the cost list's key ──

/** Where a catalogue selling price came from: a store cell's reasons, or the master's. */
export type CatalogPriceSource = "exact" | "brand" | "band" | "adjusted" | "base" | MasterLinePrice["frame_source"];

/** Selling price of a catalogue model for the scope asked about, by cost-list key. */
export interface CatalogSellingPrice {
  product_id: string;
  /** What the store (or, with no store, the chain) sells the model for, in cents. */
  price_cents: number;
  /**
   * What produced it. A store: `exact` / `band` / `adjusted` / `base`. The
   * master: `owner` (his price for the model), `band`, `rule` (the chain's
   * general rule, POST /pricing/frames/rule with no store) or `base`.
   */
  source: CatalogPriceSource;
}

/**
 * Each catalogue model's CURRENT selling price, keyed the way the cost rows are
 * (`frameCostKeyOf`), so a cost row can be joined to it. The same figure the
 * catalogue card shows (store-assortment-data.ts storeCatalogProduct) and the
 * till charges: with a store, `storeLinePrice` for the frame alone (its exact
 * price, else base + adjustment, then the band); with no store, the chain's —
 * `masterLinePrice`: the owner's global price for the model, else the Medusa
 * base through the CHAIN's general rule, then the chain band. That is the
 * price every store starts from, so the master column agrees with a store
 * that inherits (until 5-nov-2026 the master skipped the chain rule). Models
 * without a Medusa price are left out, so a missing price reads as unknown,
 * never as 0. Pure.
 */
export function catalogSellingPrices(
  catalog: readonly CatalogModel[],
  rules: PriceRuleLike[],
  storeId: string | null,
  now = new Date(),
  costRows: ReadonlyMap<string, FrameCostRow> = EMPTY_ROWS
): Map<string, CatalogSellingPrice> {
  const out = new Map<string, CatalogSellingPrice>();
  for (const m of catalog) {
    if (m.price_cents == null || !m.sku) continue;
    const scope = m.is_case ? "case" : "frame";
    const base = m.price_cents / 100;
    let usd: number;
    let source: CatalogPriceSource;
    if (storeId) {
      const line = storeLinePrice(rules, { establishmentId: storeId, scope, target: m.product_id, base, lenses: 0, brand: m.brand_slug }, now);
      usd = line.frame;
      source = line.frame_source === "store_exact" ? "exact" : line.frame_source === "brand" ? "brand" : line.band ? "band" : line.adjustment ? "adjusted" : "base";
    } else {
      const line = masterLinePrice(rules, { scope, target: m.product_id, base }, now);
      usd = line.frame;
      source = line.frame_source;
    }
    // The key the model's COST lives under (model first, v2), so the costs tab
    // joins a slug-SKU model to its supplier row.
    const key = frameCostKeyFor(costRefOf(m), costRows);
    // Two models normalising to one key (it happens in the supplier list): the
    // first wins, same as the cost side, so both halves name the same model.
    if (!out.has(key)) out.set(key, { product_id: m.product_id, price_cents: Math.round(usd * 100), source });
  }
  return out;
}

/**
 * Puts `price_cents` (and the model's `product_id` and the price's `price_source`)
 * on each cost row of `GET /admin/pricing/frames/costs`, null when the
 * catalogue has no price for that key, so the costs tab can read cost → price
 * → margin per row and say where the price came from. Appends only: the nine
 * fields of `frameCostStoreView` stay as they are. Pure.
 */
export function withCatalogPrice<T extends Record<string, unknown>>(
  rows: T[],
  prices: ReadonlyMap<string, CatalogSellingPrice>
): Array<T & { price_cents: number | null; product_id: string | null; price_source: CatalogPriceSource | null }> {
  return rows.map((r) => {
    const hit = prices.get(String(r["sku"] ?? ""));
    return { ...r, price_cents: hit ? hit.price_cents : null, product_id: hit ? hit.product_id : null, price_source: hit ? hit.source : null };
  });
}

/** Audit payload of a master edit — the figures only, never a whole row. */
export function frameCostAudit(row: FrameCostRow | null): Record<string, unknown> | null {
  return row ? { sku: row.sku, cost_cents: row.cost_cents, source: row.source } : null;
}

/** Audit payload of a store's variation. `null` is the store inheriting again. */
export function frameCostVariationAudit(row: FrameCostVariationRow | null): Record<string, unknown> | null {
  return row ? { sku: row.sku, cost_cents: row.cost_cents, store: row.establishment_id, origin: "store_variation" } : null;
}
