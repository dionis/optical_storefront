/**
 * «Productos y precios»: ONE matrix where each row is an article (frame, case,
 * lens cell, treatment) and the columns are its cost and, per store, its price
 * and the owner's own discount (docs/PRICE-MATRIX.md — the contract).
 *
 * PURE: no container, no database. The loaders and writers are in
 * lib/price-matrix-data.ts. Nothing here computes a price of its own:
 *
 *   frames / cases   `storeLinePrice` (lib/store-pricing.ts), the till's function
 *   lens cells       `applyStoreLensPrice` (lib/pricing-overview.ts), the quote's
 *   cost             `resolveFrameCost` (lib/frame-cost.ts) / the cell's lab cost
 *   exposure         `isExposed` (lib/store-assortment.ts)
 *
 * so the screen can never disagree with the receipt. The only arithmetic that
 * is new is the discount itself (`applyPct`): a percentage off a price in
 * cents, rounded to the cent PER PART (frame, lens cell, photochromic, AR), so
 * the parts on the receipt add up to the line.
 */
import { frameCostKeyFor, frameCostRowExact, resolveFrameCost, upcsOf, type FrameCostRef, type FrameCostRow, type FrameCostVariationIndex } from "./frame-cost";
import { absoluteImageUrl } from "./image-url";
import { defaultLensFinish, LENS_FINISHES, parseLensFinish, type LensFinish } from "./lens-finish";
import type { LensMatrixPayload, LensMatrixRow } from "./lens-matrix";
import {
  applyStoreLensPrice,
  lensArKey,
  lensBaseKey,
  lensPhotoKey,
  parseLensBaseKey,
  storeLensAdjustPct,
  type LensStorePriceLike,
} from "./pricing-overview";
import { brandOf, isExposed, type AssortmentRuleLike } from "./store-assortment";
import { brandPriceRule, brandTarget, globalPrice, hasGlobalPrice, storeLinePrice, type PriceRuleLike, type StoreLinePrice } from "./store-pricing";

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const MATRIX_SECTIONS = ["frames", "cases", "lenses", "treatments"] as const;
export type MatrixSection = (typeof MATRIX_SECTIONS)[number];
export const isMatrixSection = (v: unknown): v is MatrixSection => MATRIX_SECTIONS.includes(v as MatrixSection);

/** What a row (and a `store_item_discount.item_kind`) is. */
export const ITEM_KINDS = ["frame", "case", "lens", "photo", "ar"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const isItemKind = (v: unknown): v is ItemKind => ITEM_KINDS.includes(v as ItemKind);

export const CELL_FIELDS = ["cost", "price", "discount"] as const;
export type CellField = (typeof CELL_FIELDS)[number];

/** The section a row of each kind lives in. */
export const SECTION_OF_KIND: Record<ItemKind, MatrixSection> = {
  frame: "frames",
  case: "cases",
  lens: "lenses",
  photo: "treatments",
  ar: "treatments",
};

/** The highest promotion the owner can put on an article (contract: 0–90). */
export const MAX_DISCOUNT_PCT = 90;
/** A price or a cost above this, in dollars, is a typo. */
export const MAX_AMOUNT_USD = 100_000;
export const PHOTO_CATEGORIES = ["sv", "bifocal", "prog"] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
const PHOTO_COLUMNS: ReadonlyArray<[column: string, category: PhotoCategory]> = [
  ["price_sv_cents", "sv"],
  ["price_bifocal_cents", "bifocal"],
  ["price_prog_cents", "prog"],
];
/** AR codes the quote prices from the treatment matrix (design × material) when it has a cell. */
export const MATERIAL_PRICED_AR = new Set(["ar-green", "ar-blue"]);

const toCents = (usd: number): number => Math.round(usd * 100);
const roundPct = (n: number): number => Math.round(n * 100) / 100;

// ── The discount ─────────────────────────────────────────────────────────────

/**
 * `cents` with `pct` % off, rounded to the cent. Never below zero; a missing,
 * zero or negative percentage is "no discount"; anything above the cap is held
 * at the cap. Integer arithmetic on the hundreds so 10 % of $60.00 is exactly
 * $54.00.
 */
export function applyPct(cents: number, pct: number | null | undefined): number {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const p = Number(pct);
  if (pct == null || !Number.isFinite(p) || p <= 0) return c;
  const clamped = Math.min(p, MAX_DISCOUNT_PCT);
  return Math.max(0, Math.round((c * (100 - clamped)) / 100));
}

export interface ItemDiscountLike {
  establishment_id: string;
  item_kind: string;
  item_key: string;
  pct: number;
}

/** store → "kind|key" → pct. */
export type DiscountIndex = ReadonlyMap<string, ReadonlyMap<string, number>>;
export const EMPTY_DISCOUNTS: DiscountIndex = new Map();

export const discountKey = (kind: string, key: string): string => `${kind}|${key}`;

/** Group live discount rows by store; a 0 (or a broken figure) is no discount. */
export function indexItemDiscounts(rows: readonly ItemDiscountLike[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const pct = roundPct(Number(r.pct));
    if (!r.establishment_id || !r.item_kind || !r.item_key || !Number.isFinite(pct) || pct <= 0) continue;
    const bucket = out.get(r.establishment_id) ?? new Map<string, number>();
    bucket.set(discountKey(r.item_kind, r.item_key), Math.min(pct, MAX_DISCOUNT_PCT));
    out.set(r.establishment_id, bucket);
  }
  return out;
}

/** The store's discount on one article, or null when it has none. */
export function discountOf(index: DiscountIndex, storeId: string | null | undefined, kind: string, key: string): number | null {
  if (!storeId || !key) return null;
  return index.get(storeId)?.get(discountKey(kind, key)) ?? null;
}

/**
 * The discount on a catalogue product, whichever section the owner typed it
 * in: a model can sit in «Estuches» by its brand and still be quoted as a
 * frame, and the product id is the same either way.
 */
export function productDiscountOf(
  index: DiscountIndex,
  storeId: string | null | undefined,
  productId: string | null | undefined,
  brandSlug?: string | null
): number | null {
  if (!productId) return null;
  // v2: the model's own discount, else its BRAND's in that store (`item_kind` "brand", key = slug).
  return discountOf(index, storeId, "frame", productId) ?? discountOf(index, storeId, "case", productId) ?? brandDiscountOf(index, storeId, brandSlug);
}

/** `store_item_discount.item_kind` of a brand's discount (v2); `item_key` is the brand slug. */
export const BRAND_DISCOUNT_KIND = "brand";

/** A store's discount on a whole brand, or null. */
export function brandDiscountOf(index: DiscountIndex, storeId: string | null | undefined, brandSlug: string | null | undefined): number | null {
  if (!brandSlug) return null;
  return discountOf(index, storeId, BRAND_DISCOUNT_KIND, brandSlug);
}

// ── One line of the till, with the promotion ────────────────────────────────

/** Per-part percentages of one sale line; null = that part has no discount. */
export interface LinePromoPcts {
  frame_pct: number | null;
  lens_pct: number | null;
  photo_pct: number | null;
  ar_pct: number | null;
}

/** What a sale line stores in its metadata as `promo` (and the receipts show). */
export interface LinePromo extends LinePromoPcts {
  /** The line's store price BEFORE the promotion, in cents. */
  before_cents: number;
}

export const NO_PROMO: LinePromoPcts = { frame_pct: null, lens_pct: null, photo_pct: null, ar_pct: null };

/**
 * The percentages that apply to a line: the frame's by product, the lens
 * cell's by `lensBaseKey`, the photochromic's by `code:category` and the AR's
 * by code — the keys a store's own lens price uses. Pure.
 */
export function linePromoPcts(
  index: DiscountIndex,
  storeId: string,
  line: {
    productId: string | null;
    /** The model's brand slug (v2): its brand discount applies when the model has none. */
    brandSlug?: string | null;
    selection: { design_code: string; material_code?: string | null; photo_code?: string | null; ar_code?: string | null };
    category: string | null;
    finish: LensFinish | null;
  }
): LinePromoPcts {
  const s = line.selection;
  const withLenses = s.design_code !== "frame-only";
  const category = line.category ?? "";
  return {
    frame_pct: productDiscountOf(index, storeId, line.productId, line.brandSlug),
    lens_pct:
      withLenses && s.material_code
        ? discountOf(index, storeId, "lens", lensBaseKey(s.design_code, s.material_code, line.finish ?? defaultLensFinish(category), category))
        : null,
    photo_pct: withLenses && s.photo_code ? discountOf(index, storeId, "photo", lensPhotoKey(s.photo_code, category)) : null,
    ar_pct: withLenses && s.ar_code ? discountOf(index, storeId, "ar", lensArKey(s.ar_code)) : null,
  };
}

export interface PromoLineInput {
  establishmentId: string;
  scope: "frame" | "case";
  /** Product id; "" for the frame the customer brought. */
  target: string;
  /** The model's brand slug (v2): the store's brand price applies when the model has no exact one. */
  brand?: string | null;
  /** Medusa price of the frame in dollars (0 for the customer's own frame). */
  base: number;
  /** The lens add-on of THIS store, per part, in cents (lib/lens-quote.ts `computeLensBreakdown`). */
  lens: { lens_base_cents: number; photo_cents: number; ar_cents: number };
}

export interface PromoLine {
  /** The frame part after the promotion, in dollars. */
  frame: number;
  /** The lens part after the promotion, in dollars. */
  lenses: number;
  /** `storeLinePrice` BEFORE the promotion (its frame_source, band and adjustment explain the figure). */
  before: StoreLinePrice;
  /** Null when no part of the line has a discount that changed anything. */
  promo: LinePromo | null;
}

/**
 * A sale line at the store's price WITH the owner's per-article promotion.
 * Pure, and the function `quoteSale` calls (lib/pos-data.ts).
 *
 *  - The frame: the store's price (`storeLinePrice`: exact price, rule, band)
 *    and then its own % off.
 *  - The lenses: each part (cell, photochromic, AR) gets its own % off first,
 *    rounded to the cent, and the discounted add-on then goes through the same
 *    `storeLinePrice` (the legacy store-wide adjustment that also covers lenses
 *    applies to what is actually charged).
 *
 * The seller's sale discount (`discountLine`, lib/pos.ts), its limit and the
 * approval then work on THIS price — the list price of the line.
 */
export function promoStoreLine(
  rules: PriceRuleLike[],
  input: PromoLineInput,
  pcts: LinePromoPcts,
  now = new Date()
): PromoLine {
  const { lens_base_cents, photo_cents, ar_cents } = input.lens;
  const lensCents = lens_base_cents + photo_cents + ar_cents;
  const base = { establishmentId: input.establishmentId, scope: input.scope, target: input.target, base: input.base, brand: input.brand ?? null };
  const before = storeLinePrice(rules, { ...base, lenses: lensCents / 100 }, now);
  const lensAfter = applyPct(lens_base_cents, pcts.lens_pct) + applyPct(photo_cents, pcts.photo_pct) + applyPct(ar_cents, pcts.ar_pct);
  const after = lensAfter === lensCents ? before : storeLinePrice(rules, { ...base, lenses: lensAfter / 100 }, now);
  const frameBefore = toCents(before.frame);
  const frameCents = input.target ? applyPct(frameBefore, pcts.frame_pct) : frameBefore;
  const lensesCents = toCents(after.lenses);
  const beforeCents = frameBefore + toCents(before.lenses);
  const changed = frameCents !== frameBefore || lensesCents !== toCents(before.lenses);
  return {
    frame: frameCents / 100,
    lenses: lensesCents / 100,
    before,
    promo: changed
      ? {
          frame_pct: input.target ? pcts.frame_pct : null,
          lens_pct: pcts.lens_pct,
          photo_pct: pcts.photo_pct,
          ar_pct: pcts.ar_pct,
          before_cents: beforeCents,
        }
      : null,
  };
}

/** The line's effective promotion as one percentage (what a receipt prints), one decimal. */
export function promoLinePct(promo: { before_cents: number } | null | undefined, listDollars: number): number | null {
  if (!promo || !(promo.before_cents > 0)) return null;
  const off = promo.before_cents - toCents(listDollars);
  if (off <= 0) return null;
  return Math.round((off / promo.before_cents) * 1000) / 10;
}

// ── The matrix ───────────────────────────────────────────────────────────────

/**
 * Why a store cell shows its figure:
 *   store_exact  the owner fixed the price in that store
 *   brand        the store's price for every model of the brand (v2)
 *   rule         the store's (or chain's) adjustment — % / fixed amount, or the
 *                store's "% over the master" on the lens list
 *   band         the floor or ceiling moved a computed frame price
 *   master       the owner's own chain price (a frame's global price, or the
 *                master lens list)
 *   base         the bare Medusa price of the model
 */
export type CellSource = "store_exact" | "brand" | "rule" | "band" | "master" | "base";

export interface MatrixStore {
  id: string;
  code: string;
  name: string;
  color: string;
}

export interface MatrixCell {
  /** The store's price before its discount, in cents; null when the article has none. */
  price_cents: number | null;
  source: CellSource;
  /** True when the owner typed this store's price (clearing it goes back to the rule). */
  exact: boolean;
  /** The store's own % off; null = none. */
  discount_pct: number | null;
  /** What the till charges: `price_cents` with the discount; null with no price. */
  final_cents: number | null;
  /** Whether the store sells it (assortment); always true for lenses and treatments. */
  exposed: boolean;
}

export interface MatrixRow {
  kind: ItemKind;
  /** product_id, or the lens / treatment key the writes use. */
  key: string;
  title: string;
  // frames / cases
  product_id?: string;
  sku?: string;
  skus?: string[];
  thumbnail?: string | null;
  status?: string;
  brand_slug?: string;
  /** Frames/cases: ISO date the catalogue first saw the model (metadata.first_seen_at), or null. */
  first_seen_at?: string | null;
  // lenses
  design_code?: string;
  material_code?: string;
  /** Lenses, additive: the material's labels, so the screen titles the row in the chosen language. */
  material_label_es?: string;
  material_label_en?: string;
  finish?: LensFinish;
  // treatments
  code?: string;
  category?: string;
  ar_group?: string;
  label_es?: string;
  label_en?: string;
  /**
   * True for a treatment the quote prices by design × material (the treatment
   * matrix) whenever that cell exists, so the row's master figure is only the
   * fallback. A store's own price and discount still apply to it.
   */
  by_material?: boolean;
  /** frames / cases: the scope the till prices it with (lib/pos-data.ts caseProductIds). */
  price_scope?: "frame" | "case";
  /**
   * Lenses only, additive: `false` on a «digital» cell the master list does not
   * price yet (a design whose default is stock). Its prices are null and the
   * till does not offer the finish; typing a price in ANY store creates the
   * master cell at that price (every store then sells it, a store's own price
   * goes on top as usual). Absent = an existing cell.
   */
  available?: boolean;
  /** The chain's own price of the article, in cents (frames: `masterLinePrice`-free base or the owner's price; lenses: the master list). */
  master_cents?: number | null;
  /** Cost viewers only (`redactMatrixCosts`). */
  cost_cents?: number | null;
  cost_source?: string | null;
  /**
   * Frames / cases, cost viewers only (v2): the supplier key the cost lives
   * (or would be written) under — the MODEL's ("DC50"), not the SKU's, so a
   * slug-SKU model writes its cost where every reader resolves it.
   */
  cost_key?: string;
  stores: Record<string, MatrixCell>;
}

export interface MatrixGroup {
  key: string;
  label: string;
  /** Lens designs only, additive: the English label of the design (`label` is the Spanish one). */
  label_en?: string;
  kind: "brand" | "design" | "treatment";
  rows: MatrixRow[];
  /**
   * Brand groups only (additive to the contract): per store, the brand's own
   * assortment rule (true / false, null = no rule, exposed by default) and how
   * many of the group's rows the store sells — what the accordion header's
   * per-store switch shows. The switch itself writes through
   * `POST /admin/store-assortment/:id/rule`.
   */
  stores?: Record<string, MatrixBrandStore>;
  /** Brand groups (v2): the brand's logo — absolute URL, or a path on the panel's origin (`/brands/logo-….png`); null = none. */
  logo_url?: string | null;
}

/** One store's brand header (v2 adds the brand price and the brand discount). */
export interface MatrixBrandStore {
  brand_rule: boolean | null;
  exposed_rows: number;
  /** The store's price for every model of the brand (no exact price of their own), cents; null = none. */
  brand_price_cents?: number | null;
  /** The store's discount on the brand (models without their own), %; null = none. */
  brand_discount_pct?: number | null;
}

export interface MatrixResponse {
  section: MatrixSection;
  cost_access: boolean;
  stores: MatrixStore[];
  groups: MatrixGroup[];
}

/** A catalogue model as the matrix reads it. */
export interface MatrixProduct {
  product_id: string;
  title: string;
  /** Absolute URL (lib/image-url.ts), never a bare storage key. */
  thumbnail: string | null;
  /** Every colour's UPC (`metadata.upc_by_color`), the last way a cost is matched. */
  upcs?: string[];
  status: string;
  brand_slug: string;
  /** Display name from the metadata ("Di Caprio"); "" when unscraped. */
  brand_name: string;
  /** Every live variant SKU, first colour first. */
  skus: string[];
  /** Medusa price of the model, cents; null when it has none. */
  base_cents: number | null;
  /** Section: «Estuches» (brand case, metadata.kind case, or priced as a case). */
  is_case: boolean;
  /**
   * What the till prices it as chain-wide: "case" when the catalogue says it is
   * one (`metadataSaysCase`) or the owner has case rules on it. Per store the
   * matrix repeats the till's own test (`storePriceScope`).
   */
  price_scope: "frame" | "case";
  /** The catalogue says it is a case (brand case/cases or metadata.kind case). */
  meta_case?: boolean;
  /** When the catalogue first saw the model (scraper or manual add); the screen marks recent ones «nuevo». */
  first_seen_at: string | null;
}

/** A product as the catalogue query returns it (lib/price-matrix-data.ts). */
export interface MatrixProductRaw {
  product_id: string;
  title: string;
  thumbnail: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  skus: string[];
  base_cents: number | null;
}

/** The raw catalogue row classified for the matrix: section and the till's price scope. Pure. */
export function toMatrixProduct(raw: MatrixProductRaw, caseIds: ReadonlySet<string>): MatrixProduct {
  const md = raw.metadata ?? {};
  const brand_slug = brandOf(md);
  const brand_name = typeof md["brand"] === "string" ? md["brand"].trim() : "";
  return {
    product_id: raw.product_id,
    title: raw.title,
    thumbnail: absoluteImageUrl(raw.thumbnail),
    upcs: upcsOf(md),
    status: raw.status,
    brand_slug,
    brand_name,
    skus: raw.skus,
    base_cents: raw.base_cents,
    first_seen_at: typeof md["first_seen_at"] === "string" ? md["first_seen_at"] : null,
    is_case: isCaseProduct(md, brand_slug, caseIds, raw.product_id),
    price_scope: metadataSaysCase(md) || caseIds.has(raw.product_id) ? "case" : "frame",
    meta_case: metadataSaysCase(md),
  };
}

/**
 * The catalogue's own word that a model is a case: its brand is `case`/`cases`
 * or `metadata.kind` is "case" (the scraper's cases, «+ Estuche»). Pure.
 */
export function metadataSaysCase(metadata: Record<string, unknown> | null | undefined): boolean {
  const md = metadata ?? {};
  const slug = brandOf(md);
  return slug === "case" || slug === "cases" || md["kind"] === "case";
}

/**
 * The scope the till of ONE store prices a model with — the same test as
 * `quoteSale` / `searchPosProducts` (lib/pos-data.ts): a case by the catalogue,
 * or a targeted case rule that store can see (its own or the chain's). A case
 * rule of ANOTHER store does not change how this till charges. Pure.
 */
export function storePriceScope(
  rules: ReadonlyArray<{ scope: string; target: string | null; establishment_id?: string | null }>,
  storeId: string,
  productId: string,
  metaCase: boolean
): "frame" | "case" {
  if (metaCase) return "case";
  return rules.some((r) => r.scope === "case" && r.target === productId && (r.establishment_id == null || r.establishment_id === storeId)) ? "case" : "frame";
}

/** Products the owner priced as cases (rules with scope "case") — the till's own test (lib/pos-data.ts). */
export function caseProductIdsOf(rules: ReadonlyArray<{ scope: string; target: string | null }>): Set<string> {
  return new Set(rules.filter((r) => r.scope === "case" && r.target).map((r) => r.target as string));
}

/** Whether a catalogue model belongs in «Estuches». */
export function isCaseProduct(metadata: Record<string, unknown> | null | undefined, brandSlug: string, caseIds: ReadonlySet<string>, productId: string): boolean {
  return brandSlug === "case" || brandSlug === "cases" || metadata?.["kind"] === "case" || caseIds.has(productId);
}

/** The scope a price rule for this article must carry so the till reads it. */
export function priceScopeFor(kind: "frame" | "case", productId: string, caseIds: ReadonlySet<string>): "frame" | "case" {
  return kind === "case" || caseIds.has(productId) ? "case" : "frame";
}

function frameSource(line: StoreLinePrice, rules: PriceRuleLike[], scope: "frame" | "case", target: string, now: Date): CellSource {
  if (line.frame_source === "store_exact") return "store_exact";
  if (line.frame_source === "brand") return "brand";
  if (line.band) return "band";
  if (line.adjustment) return "rule";
  return hasGlobalPrice(rules, scope, target, now) ? "master" : "base";
}

/**
 * The price of a frame or case in ONE store, exactly as the till computes it
 * (frame only, no lenses), and why. Null price when the model has no Medusa
 * price and the store has no exact one. Pure.
 */
export function storeFramePrice(
  rules: PriceRuleLike[],
  storeId: string,
  product: { product_id: string; base_cents: number | null; price_scope: "frame" | "case"; brand_slug?: string | null },
  now = new Date()
): { price_cents: number | null; source: CellSource; exact: boolean } {
  const line = storeLinePrice(
    rules,
    { establishmentId: storeId, scope: product.price_scope, target: product.product_id, base: (product.base_cents ?? 0) / 100, lenses: 0, brand: product.brand_slug ?? null },
    now
  );
  const exact = line.frame_source === "store_exact";
  // A brand price is a price even when the model has none in Medusa.
  if (product.base_cents == null && !exact && line.frame_source !== "brand") return { price_cents: null, source: "base", exact: false };
  return { price_cents: toCents(line.frame), source: frameSource(line, rules, product.price_scope, product.product_id, now), exact };
}

function cellOf(price: { price_cents: number | null; source: CellSource; exact: boolean }, pct: number | null, exposed: boolean): MatrixCell {
  return {
    price_cents: price.price_cents,
    source: price.source,
    exact: price.exact,
    discount_pct: pct,
    final_cents: price.price_cents == null ? null : applyPct(price.price_cents, pct),
    exposed,
  };
}

/**
 * The rules that can touch ONE product: its own (exact, owner's global,
 * minimum) and the general ones (no target). `storeLinePrice` reads nothing
 * else, so handing it this slice gives the same figure while a 600-model ×
 * N-store matrix scans a handful of rules per cell instead of all of them.
 */
export function rulesByTarget(rules: readonly PriceRuleLike[]): (productId: string, brandSlug?: string | null) => PriceRuleLike[] {
  const general: PriceRuleLike[] = [];
  const own = new Map<string, PriceRuleLike[]>();
  for (const r of rules) {
    if (r.target == null || r.target === "") general.push(r);
    else {
      const bucket = own.get(r.target);
      if (bucket) bucket.push(r);
      else own.set(r.target, [r]);
    }
  }
  const cache = new Map<string, PriceRuleLike[]>();
  // v2: a model's slice also carries its BRAND's rules (`brand:<slug>`).
  return (productId: string, brandSlug?: string | null) => {
    const cacheKey = `${productId}|${brandSlug ?? ""}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const mine = own.get(productId) ?? [];
    const brand = brandSlug ? own.get(brandTarget(brandSlug)) ?? [] : [];
    const out = mine.length || brand.length ? [...general, ...mine, ...brand] : general;
    cache.set(cacheKey, out);
    return out;
  };
}

export interface MatrixFrameCosts {
  rows: ReadonlyMap<string, FrameCostRow>;
  variations: FrameCostVariationIndex;
}

const NO_COST_ROWS: ReadonlyMap<string, FrameCostRow> = new Map();

/**
 * The SKU that names the MODEL (cost key, export, «+ Montura»): the colour whose
 * SKU spells the title ("AGO 1023"), else the first one a cost row or the
 * supplier's list knows, else the shortest (the base before a colour suffix).
 * `skus` comes in variant-id order, which is not creation order, so its first
 * element can be any colour ("AGO 1023-02-black-gold") and would miss the cost.
 * Pure.
 */
export function modelSkuOf(p: { skus: readonly string[]; title: string }, costRows: ReadonlyMap<string, FrameCostRow> | null = null): string {
  if (!p.skus.length) return p.title;
  const titleKey = importSkuKey(p.title);
  const byTitle = p.skus.find((s) => importSkuKey(s) === titleKey);
  if (byTitle) return byTitle;
  const rows = costRows ?? NO_COST_ROWS;
  const known = p.skus.find((s) => frameCostRowExact(rows, s) !== null);
  if (known) return known;
  return [...p.skus].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] as string;
}

/**
 * One row per frame or case model, one cell per store. `costs` null = the
 * reader may not see costs and no cost key is written. Pure.
 */
export function buildFrameRows(
  products: readonly MatrixProduct[],
  stores: readonly MatrixStore[],
  rules: PriceRuleLike[],
  discounts: DiscountIndex,
  assortment: ReadonlyMap<string, AssortmentRuleLike[]>,
  costs: MatrixFrameCosts | null,
  now = new Date()
): MatrixRow[] {
  const forProduct = rulesByTarget(rules);
  return products.map((p) => {
    const rulesOf = forProduct(p.product_id, p.brand_slug);
    const kind: ItemKind = p.is_case ? "case" : "frame";
    const sku = modelSkuOf(p, costs ? costs.rows : null);
    const row: MatrixRow = {
      kind,
      key: p.product_id,
      product_id: p.product_id,
      sku,
      skus: p.skus,
      title: p.title,
      thumbnail: p.thumbnail,
      status: p.status,
      brand_slug: p.brand_slug,
      price_scope: p.price_scope,
      first_seen_at: p.first_seen_at,
      master_cents: masterCents(rulesOf, p, now),
      stores: {},
    };
    if (costs) {
      // v2: by MODEL first (the title, «DC 50» → DC50), then every colour's
      // SKU, then the UPCs — staging's SKUs are `dc-50-di-caprio-grey`.
      const ref = matrixCostRef(p, sku);
      const resolved = resolveFrameCost(costs.rows, costs.variations, ref, null);
      row.cost_cents = resolved ? resolved.cost_cents : null;
      row.cost_source = resolved ? resolved.origin : null;
      row.cost_key = resolved ? resolved.sku : frameCostKeyFor(ref, costs.rows);
    }
    for (const s of stores) {
      const scope = storePriceScope(rulesOf, s.id, p.product_id, p.meta_case ?? p.price_scope === "case");
      const price = storeFramePrice(rulesOf, s.id, scope === p.price_scope ? p : { ...p, price_scope: scope }, now);
      const exposed = isExposed(assortment.get(s.id) ?? [], { id: p.product_id, brand: p.brand_slug });
      row.stores[s.id] = cellOf(price, productDiscountOf(discounts, s.id, p.product_id, p.brand_slug), exposed);
    }
    return row;
  });
}

/** How a matrix model names itself for its cost: title (the model), the model SKU, every SKU, the UPCs. Pure. */
export function matrixCostRef(p: Pick<MatrixProduct, "title" | "skus" | "upcs">, modelSku?: string): FrameCostRef {
  const skus = modelSku && !p.skus.includes(modelSku) ? [modelSku, ...p.skus] : modelSku ? [modelSku, ...p.skus.filter((s) => s !== modelSku)] : p.skus;
  return { model: p.title, skus, upcs: p.upcs ?? [] };
}

/** The owner's own chain price of the model when he typed one, else the Medusa base, in cents. */
function masterCents(rules: PriceRuleLike[], p: MatrixProduct, now: Date): number | null {
  if (p.base_cents == null) return null;
  return hasGlobalPrice(rules, p.price_scope, p.product_id, now)
    ? toCents(globalPrice(rules, p.price_scope, p.product_id, p.base_cents / 100, now))
    : p.base_cents;
}

/**
 * Frames / cases grouped by brand (`brand_slug`), groups by label and rows by
 * title. `brandNames` is the known display names (lib/costing.ts KNOWN_BRANDS);
 * a brand it does not know is named by its metadata, else by its slug.
 */
const CASE_SLUGS = new Set(["case", "cases"]);
/** Group label of the brandless cases (Spanish, like the lens group labels). */
export const CASES_LABEL = "Estuches";

export function groupFrameRows(
  rows: readonly MatrixRow[],
  products: readonly MatrixProduct[],
  brandNames: ReadonlyMap<string, string>
): MatrixGroup[] {
  const nameOf = new Map<string, string>();
  for (const p of products) if (p.brand_name && !nameOf.has(p.brand_slug)) nameOf.set(p.brand_slug, p.brand_name);
  const groups = new Map<string, MatrixGroup>();
  for (const r of rows) {
    // A case without a brand of its own (or under the «case» pseudo-brand) goes
    // to ONE «Estuches» group, as the contract says, never to a nameless «—».
    const caseGroup = r.kind === "case" && (!r.brand_slug || CASE_SLUGS.has(r.brand_slug));
    const slug = caseGroup ? "case" : r.brand_slug || "";
    const key = slug || "other";
    const label = caseGroup ? CASES_LABEL : brandNames.get(slug) || nameOf.get(slug) || slug || "—";
    const g = groups.get(key) ?? { key, label, kind: "brand" as const, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const out = [...groups.values()];
  for (const g of out) g.rows.sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Per model, per store: what that till charges for the frame alone and the owner's discount there. */
export type SheetStorePrices = ReadonlyMap<string, ReadonlyMap<string, { price_cents: number | null; discount_pct: number | null }>>;

/**
 * The «Precio» / «Desc %» columns of the sheet's «Costos monturas» tab
 * (lib/gsheet-sync.ts), one pair per store, from the same `storeFramePrice`
 * the matrix shows. The scope is the till's (cases only when priced as cases).
 * Pure.
 */
export function storeSheetPrices(
  catalog: ReadonlyArray<{ product_id: string; price_cents: number | null; is_case?: boolean; brand_slug?: string | null }>,
  storeIds: readonly string[],
  rules: PriceRuleLike[],
  discounts: DiscountIndex,
  now = new Date()
): Map<string, Map<string, { price_cents: number | null; discount_pct: number | null }>> {
  const forProduct = rulesByTarget(rules);
  const out = new Map<string, Map<string, { price_cents: number | null; discount_pct: number | null }>>();
  for (const m of catalog) {
    const perStore = new Map<string, { price_cents: number | null; discount_pct: number | null }>();
    const rulesOf = forProduct(m.product_id, m.brand_slug);
    for (const id of storeIds) {
      const scope = m.is_case ? "case" : storePriceScope(rulesOf, id, m.product_id, false);
      const price = storeFramePrice(rulesOf, id, { product_id: m.product_id, base_cents: m.price_cents, price_scope: scope, brand_slug: m.brand_slug }, now);
      perStore.set(id, { price_cents: price.price_cents, discount_pct: productDiscountOf(discounts, id, m.product_id, m.brand_slug) });
    }
    out.set(m.product_id, perStore);
  }
  return out;
}

/** Adds each store's brand rule and exposed-row count to brand groups (`MatrixGroup.stores`). Pure. */
export function withBrandExposure(
  groups: MatrixGroup[],
  stores: readonly MatrixStore[],
  assortment: ReadonlyMap<string, AssortmentRuleLike[]>,
  pricing: { rules: PriceRuleLike[]; discounts: DiscountIndex; scope: "frame" | "case"; logos?: ReadonlyMap<string, string | null>; now?: Date } | null = null
): MatrixGroup[] {
  return groups.map((g) => {
    // The switch writes a BRAND rule named by the group key; a group whose rows
    // are not all of that brand (the brandless «Estuches», «other») cannot be
    // switched as one, so it gets no per-store header and the screen draws none.
    if (g.kind !== "brand" || g.rows.some((r) => (r.brand_slug || "") !== g.key)) return g;
    const perStore: NonNullable<MatrixGroup["stores"]> = {};
    for (const s of stores) {
      const rule = (assortment.get(s.id) ?? []).find((r) => r.scope === "brand" && r.target === g.key);
      const cell: MatrixBrandStore = { brand_rule: rule ? rule.exposed : null, exposed_rows: g.rows.filter((r) => r.stores[s.id]?.exposed).length };
      if (pricing) {
        Object.assign(cell, brandStoreCell(pricing.rules, pricing.discounts, s.id, g.key, pricing.scope, pricing.now));
      }
      perStore[s.id] = cell;
    }
    const out: MatrixGroup = { ...g, stores: perStore };
    if (pricing?.logos) out.logo_url = pricing.logos.get(g.key) ?? null;
    return out;
  });
}

/** A store's brand price (cents) and brand discount (%) for one brand and scope; nulls when none. Pure. */
export function brandStoreCell(
  rules: PriceRuleLike[],
  discounts: DiscountIndex,
  storeId: string,
  slug: string,
  scope: "frame" | "case",
  now = new Date()
): { brand_price_cents: number | null; brand_discount_pct: number | null } {
  const rule = brandPriceRule(rules, storeId, scope, slug, now);
  return {
    brand_price_cents: rule ? toCents(Number(rule.value)) : null,
    brand_discount_pct: brandDiscountOf(discounts, storeId, slug),
  };
}

/** The scope a brand's price is written and read under: cases for the case brand, frames otherwise. */
export const brandScopeOf = (slug: string, explicit?: unknown): "frame" | "case" =>
  explicit === "case" || explicit === "frame" ? explicit : CASE_SLUGS.has(slug) ? "case" : "frame";

// ── Lenses and treatments ────────────────────────────────────────────────────

/** A store's price of one lens-list cell and why. Pure. */
export function storeLensCell(
  masterCents: number,
  storeRows: readonly LensStorePriceLike[],
  target: { kind: "base" | "photo" | "ar"; key: string }
): { price_cents: number; source: CellSource; exact: boolean } {
  const exact = storeRows.some((r) => r.item_kind === target.kind && r.item_key === target.key);
  const price = applyStoreLensPrice(masterCents, storeRows as LensStorePriceLike[], target);
  const adjusted = storeLensAdjustPct(storeRows as LensStorePriceLike[]) !== null;
  return { price_cents: price, source: exact ? "store_exact" : adjusted ? "rule" : "master", exact };
}

export interface LensSectionInput {
  designs: ReadonlyArray<{ code: string; label_es: string; label_en: string; category: string }>;
  materials: ReadonlyArray<{ code: string; label_es: string; label_en: string }>;
  cells: ReadonlyArray<{ design_code: string; material_code: string; finish: LensFinish | null; price_cents: number; cost_cents: number | null }>;
  /** Each store's `lens_store_price` rows. */
  storeRows: ReadonlyMap<string, LensStorePriceLike[]>;
}

const STORE_KIND: Record<"lens" | "photo" | "ar", "base" | "photo" | "ar"> = { lens: "base", photo: "photo", ar: "ar" };

function lensCells(
  kind: "lens" | "photo" | "ar",
  key: string,
  masterCents: number,
  stores: readonly MatrixStore[],
  storeRows: ReadonlyMap<string, LensStorePriceLike[]>,
  discounts: DiscountIndex
): Record<string, MatrixCell> {
  const out: Record<string, MatrixCell> = {};
  for (const s of stores) {
    const price = storeLensCell(masterCents, storeRows.get(s.id) ?? [], { kind: STORE_KIND[kind], key });
    out[s.id] = cellOf(price, discountOf(discounts, s.id, kind, key), true);
  }
  return out;
}

/**
 * One group per lens design (the list's order), one row per priced cell
 * (material × finish), titled «<material> · <finish>». `withCosts` false =
 * no cost key. Cells of a design the list no longer offers are left out. Pure.
 */
export function buildLensGroups(input: LensSectionInput, stores: readonly MatrixStore[], discounts: DiscountIndex, withCosts: boolean): MatrixGroup[] {
  const materialSort = new Map(input.materials.map((m, i) => [m.code, i]));
  const materialLabel = new Map(input.materials.map((m) => [m.code, m.label_es || m.label_en || m.code]));
  const materialLabelEn = new Map(input.materials.map((m) => [m.code, m.label_en || m.label_es || m.code]));
  return input.designs.map((d) => {
    const rows: MatrixRow[] = input.cells
      .filter((c) => c.design_code === d.code)
      .map((c) => {
        const finish = c.finish ?? defaultLensFinish(d.category);
        const key = lensBaseKey(d.code, c.material_code, finish, d.category);
        const row: MatrixRow = {
          kind: "lens",
          key,
          title: `${materialLabel.get(c.material_code) ?? c.material_code} · ${finish}`,
          design_code: d.code,
          material_code: c.material_code,
          material_label_es: materialLabel.get(c.material_code) ?? c.material_code,
          material_label_en: materialLabelEn.get(c.material_code) ?? c.material_code,
          finish,
          category: d.category,
          master_cents: c.price_cents,
          stores: lensCells("lens", key, c.price_cents, stores, input.storeRows, discounts),
        };
        if (withCosts) {
          row.cost_cents = c.cost_cents;
          row.cost_source = c.cost_cents == null ? null : "owner_edit";
        }
        return row;
      })
      ;
    // «Tallado digital» the owner has not priced yet (a stock-default design):
    // one empty row per material, so the matrix — the only lens screen since
    // the merge — can still switch the finish on (docs/HITOS-PANEL-TIENDA.md, hito 6).
    if (defaultLensFinish(d.category) !== "digital") {
      const own = input.cells.filter((c) => c.design_code === d.code);
      const materials = [...new Set(own.map((c) => c.material_code))];
      for (const m of materials) {
        if (own.some((c) => c.material_code === m && (c.finish ?? defaultLensFinish(d.category)) === "digital")) continue;
        const off = unpricedDigitalRow(d, m, materialLabel.get(m) ?? m, stores, discounts, withCosts);
        off.material_label_en = materialLabelEn.get(m) ?? m;
        rows.push(off);
      }
    }
    rows.sort(
      (a, b) =>
        (materialSort.get(a.material_code ?? "") ?? 999) - (materialSort.get(b.material_code ?? "") ?? 999) ||
        LENS_FINISHES.indexOf(a.finish as LensFinish) - LENS_FINISHES.indexOf(b.finish as LensFinish)
    );
    return { key: d.code, label: d.label_es || d.label_en || d.code, label_en: d.label_en || d.label_es || d.code, kind: "design" as const, rows };
  });
}

/** The empty «digital» row of a material whose design has no digital cell yet. Pure. */
function unpricedDigitalRow(
  d: { code: string; category: string | null },
  material: string,
  materialLabel: string,
  stores: readonly MatrixStore[],
  discounts: DiscountIndex,
  withCosts: boolean
): MatrixRow {
  const key = lensBaseKey(d.code, material, "digital", d.category);
  const cells: Record<string, MatrixCell> = {};
  for (const s of stores) cells[s.id] = cellOf({ price_cents: null, source: "master", exact: false }, discountOf(discounts, s.id, "lens", key), true);
  const row: MatrixRow = {
    kind: "lens",
    key,
    title: `${materialLabel} · digital`,
    design_code: d.code,
    material_code: material,
    material_label_es: materialLabel,
    finish: "digital",
    category: d.category ?? undefined,
    master_cents: null,
    available: false,
    stores: cells,
  };
  if (withCosts) {
    row.cost_cents = null;
    row.cost_source = null;
  }
  return row;
}

export interface TreatmentSectionInput {
  photos: readonly LensMatrixRow[];
  ars: readonly LensMatrixRow[];
  /** Lab cost by option code (null = unknown). */
  photoCosts: ReadonlyMap<string, number | null>;
  arCosts: ReadonlyMap<string, number | null>;
  storeRows: ReadonlyMap<string, LensStorePriceLike[]>;
  /** Whether the treatment matrix prices photochromics by design × material. */
  photoByMaterial: boolean;
}

const centsOf = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * «Fotocromáticos» (one row per option × category it is offered in, key
 * `code:category`) and «Antirreflejo» (one row per option, key `code`). Pure.
 */
export function buildTreatmentGroups(input: TreatmentSectionInput, stores: readonly MatrixStore[], discounts: DiscountIndex, withCosts: boolean): MatrixGroup[] {
  const photoRows: MatrixRow[] = [];
  for (const p of input.photos) {
    const code = String(p["code"] ?? "");
    if (!code) continue;
    for (const [column, category] of PHOTO_COLUMNS) {
      const master = centsOf(p[column]);
      // A category the option is not offered in has no row: there is nothing to price.
      if (master == null) continue;
      const key = lensPhotoKey(code, category);
      const row: MatrixRow = {
        kind: "photo",
        key,
        title: `${String(p["label_es"] ?? code)} · ${category}`,
        code,
        category,
        label_es: String(p["label_es"] ?? ""),
        label_en: String(p["label_en"] ?? ""),
        by_material: input.photoByMaterial,
        master_cents: master,
        stores: lensCells("photo", key, master, stores, input.storeRows, discounts),
      };
      if (withCosts) {
        const cost = input.photoCosts.get(code) ?? null;
        row.cost_cents = cost;
        row.cost_source = cost == null ? null : "owner_edit";
      }
      photoRows.push(row);
    }
  }
  const arRows: MatrixRow[] = input.ars
    .filter((a) => String(a["code"] ?? ""))
    .map((a) => {
      const code = String(a["code"]);
      const master = centsOf(a["price_cents"]) ?? 0;
      const key = lensArKey(code);
      const row: MatrixRow = {
        kind: "ar",
        key,
        title: String(a["label_es"] ?? code),
        code,
        ar_group: String(a["ar_group"] ?? "all"),
        label_es: String(a["label_es"] ?? ""),
        label_en: String(a["label_en"] ?? ""),
        by_material: MATERIAL_PRICED_AR.has(code),
        master_cents: master,
        stores: lensCells("ar", key, master, stores, input.storeRows, discounts),
      };
      if (withCosts) {
        const cost = input.arCosts.get(code) ?? null;
        row.cost_cents = cost;
        row.cost_source = cost == null ? null : "owner_edit";
      }
      return row;
    });
  return [
    { key: "photo", label: "Fotocromáticos", kind: "treatment", rows: photoRows },
    { key: "ar", label: "Antirreflejo", kind: "treatment", rows: arRows },
  ];
}

/**
 * The groups as a reader WITHOUT cost privileges may see them: `cost_cents` and
 * `cost_source` REMOVED (not nulled) from every row. Done on the server, like
 * `redactLensCosts`. Pure.
 */
export function redactMatrixCosts(groups: MatrixGroup[], canSeeCosts: boolean): MatrixGroup[] {
  if (canSeeCosts) return groups;
  return groups.map((g) => ({ ...g, rows: g.rows.map(redactMatrixRow) }));
}

export function redactMatrixRow(row: MatrixRow): MatrixRow {
  if (!("cost_cents" in row) && !("cost_source" in row)) return row;
  const { cost_cents: _c, cost_source: _s, ...rest } = row;
  return rest;
}

// ── The till's lens list with the discounts ──────────────────────────────────

/**
 * The lens list a store sells from (`applyStoreLensMatrix`) with that store's
 * per-article discounts applied, cell by cell, the way the quote applies them.
 * A discounted cell keeps the reduced price in its usual field and gains the
 * figure before it and the percentage:
 *
 *   base_prices[]   price_cents ↓, `price_before_cents`, `discount_pct`
 *   photos[]        price_<cat>_cents ↓, `price_before: { <cat>: cents }`, `discount_pct: { <cat>: pct }`
 *   ars[]           price_cents ↓, `price_before_cents`, `discount_pct`
 *
 * Nothing changes on a cell without a discount, so a store with none gets the
 * very payload it got before. Pure.
 */
export function applyLensMatrixDiscounts(matrix: LensMatrixPayload, discounts: DiscountIndex, storeId: string | null | undefined): LensMatrixPayload {
  if (!storeId || !discounts.get(storeId)?.size) return matrix;
  const categoryOf = new Map<string, string>();
  for (const d of matrix.designs) categoryOf.set(String(d["code"]), String(d["category"] ?? ""));

  const base_prices = matrix.base_prices.map((cell) => {
    const category = categoryOf.get(cell.design_code) ?? null;
    const finish = cell.finish ?? defaultLensFinish(category);
    const pct = discountOf(discounts, storeId, "lens", lensBaseKey(cell.design_code, cell.material_code, finish, category));
    if (!pct) return cell;
    return { ...cell, price_cents: applyPct(cell.price_cents, pct), price_before_cents: cell.price_cents, discount_pct: pct };
  });

  const photos = matrix.photos.map((p) => {
    const code = String(p["code"] ?? "");
    let out: LensMatrixRow | null = null;
    const before: Record<string, number> = {};
    const pcts: Record<string, number> = {};
    for (const [column, category] of PHOTO_COLUMNS) {
      const master = centsOf(p[column]);
      if (master == null) continue;
      const pct = discountOf(discounts, storeId, "photo", lensPhotoKey(code, category));
      if (!pct) continue;
      out = out ?? { ...p };
      out[column] = applyPct(master, pct);
      before[category] = master;
      pcts[category] = pct;
    }
    return out ? { ...out, price_before: before, discount_pct: pcts } : p;
  });

  const ars = matrix.ars.map((a) => {
    const pct = discountOf(discounts, storeId, "ar", lensArKey(String(a["code"] ?? "")));
    if (!pct) return a;
    const master = centsOf(a["price_cents"]) ?? 0;
    return { ...a, price_cents: applyPct(master, pct), price_before_cents: master, discount_pct: pct };
  });

  return { ...matrix, base_prices, photos, ars };
}

// ── Writing one cell ─────────────────────────────────────────────────────────

/** What one cell write does, decided before anything is read or written. */
export type CellOp =
  | { op: "frame_cost"; kind: "frame" | "case"; productId: string; cents: number | null }
  | { op: "frame_price"; kind: "frame" | "case"; productId: string; storeId: string; usd: number | null }
  | { op: "lens_cost"; kind: "lens" | "photo" | "ar"; storeKind: "base" | "photo" | "ar"; key: string; cents: number | null }
  | { op: "lens_price"; kind: "lens" | "photo" | "ar"; storeKind: "base" | "photo" | "ar"; key: string; storeId: string; cents: number | null }
  | { op: "discount"; kind: ItemKind; key: string; storeId: string; pct: number | null }
  // v2: a brand's price / discount in one store (`kind: "brand"`, key = slug).
  | { op: "brand_price"; slug: string; storeId: string; scope: "frame" | "case"; usd: number | null }
  | { op: "brand_discount"; slug: string; storeId: string; pct: number | null };

/** A brand slug as the catalogue writes it (lib/catalog-frame.ts brandSlugOf). */
export const isBrandSlug = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,59}$/.test(v);

const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * A cell's value as typed: dollars for `cost` / `price` (returned in CENTS),
 * a percentage for `discount`. Blank / null = clear the cell. A discount of 0
 * is also "no discount". Returns the parsed value or a reason code.
 */
export function parseCellValue(field: CellField, raw: unknown): { value: number | null } | { reason: string } {
  if (isBlank(raw)) return { value: null };
  if (typeof raw === "boolean" || (typeof raw !== "number" && typeof raw !== "string")) return { reason: "bad_value" };
  const n = Number(typeof raw === "string" ? raw.trim().replace(/^\$/, "").replace(/%$/, "") : raw);
  if (!Number.isFinite(n)) return { reason: "bad_value" };
  if (field === "discount") {
    if (n < 0 || n > MAX_DISCOUNT_PCT) return { reason: "discount_range" };
    const pct = roundPct(n);
    return { value: pct === 0 ? null : pct };
  }
  if (n < 0 || n > MAX_AMOUNT_USD) return { reason: "bad_value" };
  return { value: Math.round(n * 100) };
}

/** Whether `key` names a row of `kind` (shape only; existence is the loader's). */
export function itemKeyDenied(kind: ItemKind, key: unknown): string | null {
  if (typeof key !== "string" || !key.trim() || key.length > 120) return "unknown_item";
  if (kind === "lens") return parseLensBaseKey(key) ? null : "unknown_item";
  if (kind === "photo") {
    const [code, category, ...rest] = key.split(":");
    return code && (PHOTO_CATEGORIES as readonly string[]).includes(category ?? "") && !rest.length ? null : "unknown_item";
  }
  if (kind === "ar") return key.includes(":") ? "unknown_item" : null;
  return null;
}

export interface CellWriteInput {
  kind: unknown;
  key: unknown;
  field: unknown;
  /** Store id as sent; existence is checked by the route. */
  store: unknown;
  value: unknown;
  /** `kind: "brand"` only: "frame" | "case" (default: case for the case brand, frame otherwise). */
  scope?: unknown;
}

/**
 * Validates one write of `POST /admin/pricing/matrix/cell` and says which
 * writer runs it. Pure: the route only resolves the store and the item.
 *
 *   cost      frame / case → store_frame_cost (owner_edit; null → supplier list)
 *             lens / photo / ar → the master list's lab cost (null → unknown)
 *   price     frame / case → the store's exact price (store_price_rule override; null → the rule)
 *             lens / photo / ar → the store's own cell (lens_store_price; null → the master / its %)
 *   discount  any → store_item_discount (null or 0 → no discount)
 */
/**
 * The matrix cell writes an «Editar modelo» asks for (`cost`, `prices` of
 * POST /admin/catalog/frames/:id), as `planCellWrite` inputs — only the
 * figures that CHANGE against the row as the matrix shows it today. The
 * dialog sends the cost it was opened with every time; writing it again would
 * turn a Capri cost into an owner edit, and a brand discount shown in the form
 * would become the model's own. Unknown store → `store_not_found`; a bad value
 * → the cell's reason. Pure. (QA v2: the route ignored both and the dialog
 * said «actualizado».)
 */
export function frameEditCellWrites(
  body: Record<string, unknown>,
  row: Pick<MatrixRow, "kind" | "key" | "cost_cents" | "cost_source" | "stores">,
  storeIds: readonly string[]
): { writes: CellWriteInput[] } | { reason: string } {
  const writes: CellWriteInput[] = [];
  const base = { kind: row.kind, key: row.key };
  if ("cost" in body) {
    const parsed = parseCellValue("cost", body["cost"]);
    if ("reason" in parsed) return parsed;
    const now = row.cost_cents ?? null;
    const changed = parsed.value === null ? row.cost_source === "owner_edit" : parsed.value !== now;
    if (changed) writes.push({ ...base, field: "cost", store: null, value: body["cost"] });
  }
  const prices = body["prices"];
  if (prices != null) {
    if (typeof prices !== "object" || Array.isArray(prices)) return { reason: "bad_value" };
    for (const [storeId, raw] of Object.entries(prices as Record<string, unknown>)) {
      if (!storeIds.includes(storeId)) return { reason: "store_not_found" };
      const cellIn = (raw ?? {}) as Record<string, unknown>;
      if (typeof cellIn !== "object" || Array.isArray(cellIn)) return { reason: "bad_value" };
      const cur = row.stores?.[storeId];
      if ("price" in cellIn) {
        const parsed = parseCellValue("price", cellIn["price"]);
        if ("reason" in parsed) return parsed;
        const exactNow = cur?.exact ? cur.price_cents : null;
        if (parsed.value !== exactNow) writes.push({ ...base, field: "price", store: storeId, value: cellIn["price"] });
      }
      if ("discount" in cellIn) {
        const parsed = parseCellValue("discount", cellIn["discount"]);
        if ("reason" in parsed) return parsed;
        if (parsed.value !== (cur?.discount_pct ?? null)) writes.push({ ...base, field: "discount", store: storeId, value: cellIn["discount"] });
      }
    }
  }
  return { writes };
}

export function planCellWrite(input: CellWriteInput): { op: CellOp } | { reason: string } {
  if (input.kind === "brand") return planBrandCellWrite(input);
  if (!isItemKind(input.kind)) return { reason: "bad_kind" };
  const kind = input.kind;
  if (!CELL_FIELDS.includes(input.field as CellField)) return { reason: "bad_field" };
  const field = input.field as CellField;
  const store = isBlank(input.store) ? null : String(input.store).trim();
  if (field === "cost" && store) return { reason: "store_not_allowed" };
  if (field !== "cost" && !store) return { reason: "store_required" };
  const parsed = parseCellValue(field, input.value);
  if ("reason" in parsed) return parsed;
  const keyDenied = itemKeyDenied(kind, input.key);
  if (keyDenied) return { reason: keyDenied };
  const key = String(input.key).trim();
  const value = parsed.value;

  if (field === "discount") return { op: { op: "discount", kind, key, storeId: store as string, pct: value } };
  if (kind === "frame" || kind === "case") {
    return field === "cost"
      ? { op: { op: "frame_cost", kind, productId: key, cents: value } }
      : { op: { op: "frame_price", kind, productId: key, storeId: store as string, usd: value === null ? null : value / 100 } };
  }
  const storeKind = STORE_KIND[kind];
  return field === "cost"
    ? { op: { op: "lens_cost", kind, storeKind, key, cents: value } }
    : { op: { op: "lens_price", kind, storeKind, key, storeId: store as string, cents: value } };
}

/**
 * `kind: "brand"` (v2): the price or the discount of a whole brand in one
 * store. No cost (`bad_field`: a brand has none of its own), a store always.
 *
 *   price     store_price_rule `scope` frame|case, `target` brand:<slug>, mode override (null → none)
 *   discount  store_item_discount `item_kind` brand, `item_key` slug (null / 0 → none)
 */
function planBrandCellWrite(input: CellWriteInput): { op: CellOp } | { reason: string } {
  if (input.field !== "price" && input.field !== "discount") return { reason: "bad_field" };
  const store = isBlank(input.store) ? null : String(input.store).trim();
  if (!store) return { reason: "store_required" };
  const parsed = parseCellValue(input.field, input.value);
  if ("reason" in parsed) return parsed;
  const slug = typeof input.key === "string" ? input.key.trim().toLowerCase() : "";
  if (!isBrandSlug(slug)) return { reason: "unknown_item" };
  if (!isBlank(input.scope) && input.scope !== "frame" && input.scope !== "case") return { reason: "bad_value" };
  if (input.field === "discount") return { op: { op: "brand_discount", slug, storeId: store, pct: parsed.value } };
  return { op: { op: "brand_price", slug, storeId: store, scope: brandScopeOf(slug, input.scope), usd: parsed.value === null ? null : parsed.value / 100 } };
}

// ── Import ───────────────────────────────────────────────────────────────────

/** The import's own section for the «Marcas» sheet (v2): not a matrix section, a brand header. */
export const IMPORT_BRAND_SECTION = "brands";
export type ImportSection = MatrixSection | typeof IMPORT_BRAND_SECTION;

export interface ImportChange {
  /** 0-based position of the row in the request. */
  row: number;
  section: ImportSection;
  /** The article as the owner reads it: SKU for frames and cases, the key otherwise (the slug for a brand). */
  item: string;
  title: string;
  kind: ItemKind | "brand";
  /** The key the writer uses (product id, lens / treatment key, or brand slug). */
  key: string;
  /** Brand rows only: the scope the brand price is written under. */
  scope?: "frame" | "case";
  field: CellField;
  store: string | null;
  store_code: string | null;
  /** Dollars for cost / price (the effective figure today), a percentage for discount; null = empty. */
  before: number | null;
  after: number | null;
}

export interface ImportError {
  row: number;
  reason: string;
  detail: string | null;
}

export interface ImportPlan {
  changes: ImportChange[];
  errors: ImportError[];
  counts: { rows: number; changes: number; errors: number; cost: number; price: number; discount: number; unchanged: number };
}

/** The current matrix, indexed the way an import row names an article. */
export interface ImportIndex {
  /** Frames and cases by normalised SKU (every colour's) — see `importSkuKey`. */
  products: ReadonlyMap<string, MatrixRow>;
  lenses: ReadonlyMap<string, MatrixRow>;
  treatments: ReadonlyMap<string, MatrixRow>;
  /** v2: brand headers by slug («Marcas»); absent = the request names none. */
  brands?: ReadonlyMap<string, ImportBrand>;
  stores: readonly MatrixStore[];
}

/** A brand as the «Marcas» sheet names it, with today's price and discount per store. */
export interface ImportBrand {
  slug: string;
  label: string;
  scope: "frame" | "case";
  stores: Record<string, { brand_price_cents: number | null; brand_discount_pct: number | null }>;
}

/** Brand groups of the frames and cases sections as import targets (first section wins on a slug). Pure. */
export function indexImportBrands(groups: readonly MatrixGroup[], scope: "frame" | "case", into: Map<string, ImportBrand>): void {
  for (const g of groups) {
    if (g.kind !== "brand" || !g.stores || into.has(g.key)) continue;
    const stores: ImportBrand["stores"] = {};
    for (const [id, c] of Object.entries(g.stores)) stores[id] = { brand_price_cents: c.brand_price_cents ?? null, brand_discount_pct: c.brand_discount_pct ?? null };
    into.set(g.key, { slug: g.key, label: g.label, scope, stores });
  }
}

/** How an import SKU is matched: case and punctuation do not matter ("dc-407" = "DC407"). */
export const importSkuKey = (sku: string): string => sku.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Index a section's groups for `buildImportPlan`. Pure. */
export function indexImportRows(groups: readonly MatrixGroup[], into: { products: Map<string, MatrixRow>; lenses: Map<string, MatrixRow>; treatments: Map<string, MatrixRow> }): void {
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.kind === "frame" || r.kind === "case") {
        for (const sku of r.skus?.length ? r.skus : [r.sku ?? ""]) {
          const k = importSkuKey(sku);
          if (k && !into.products.has(k)) into.products.set(k, r);
        }
      } else if (r.kind === "lens") into.lenses.set(r.key, r);
      else into.treatments.set(r.key, r);
    }
  }
}

const dollarsOf = (c: number | null | undefined): number | null => (c == null ? null : c / 100);

/**
 * The plan of `POST /admin/pricing/matrix/import`: every cell the request
 * would change, with its figure today and after, and every row it cannot
 * apply. Nothing is written here. Pure.
 *
 *  - Frames and cases are found by `sku` (any colour's), the rest by `key`;
 *    stores by their `code`.
 *  - A cell ABSENT from the row is not touched; `null` (or "") empties it.
 *  - A cell whose value is already what is stored is not a change (counted
 *    as `unchanged`), so re-importing the exported book is a no-op.
 *  - A lens key may be spelled as the panel shows it ("prog-mid:cr39:digital");
 *    `canonicalKey` maps it to the stored spelling.
 */
export function buildImportPlan(rows: unknown, index: ImportIndex, canonicalKey: (key: string) => string = (k) => k): ImportPlan {
  const changes: ImportChange[] = [];
  const errors: ImportError[] = [];
  let unchanged = 0;
  const list = Array.isArray(rows) ? rows : [];
  const storeByCode = new Map(index.stores.map((s) => [s.code.trim().toUpperCase(), s]));

  list.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({ row: i, reason: "bad_row", detail: null });
      return;
    }
    const r = raw as Record<string, unknown>;
    const section = r["section"];
    if (section === IMPORT_BRAND_SECTION) {
      planBrandImportRow(i, r, index, storeByCode, changes, errors, () => unchanged++);
      return;
    }
    if (!isMatrixSection(section)) {
      errors.push({ row: i, reason: "bad_section", detail: section == null ? null : String(section) });
      return;
    }
    let item: MatrixRow | undefined;
    let label: string;
    if (section === "frames" || section === "cases") {
      label = typeof r["sku"] === "string" ? r["sku"].trim() : "";
      item = label ? index.products.get(importSkuKey(label)) : undefined;
    } else {
      label = typeof r["key"] === "string" ? r["key"].trim() : "";
      const key = label ? canonicalKey(label) : "";
      item = section === "lenses" ? index.lenses.get(key) : index.treatments.get(key);
    }
    if (!item) {
      errors.push({ row: i, reason: "unknown_item", detail: label || null });
      return;
    }
    const base = { row: i, section, item: label, title: item.title, kind: item.kind, key: item.key };

    if ("cost" in r) {
      const parsed = parseCellValue("cost", r["cost"]);
      if ("reason" in parsed) errors.push({ row: i, reason: parsed.reason, detail: "cost" });
      else {
        const now = item.cost_cents ?? null;
        // A frame's cost "cleared" goes back to the supplier's list: only a
        // figure the owner typed can be cleared.
        const owned = item.kind === "frame" || item.kind === "case" ? item.cost_source === "owner_edit" : now != null;
        const same = parsed.value === null ? !owned : parsed.value === now;
        if (same) unchanged++;
        else changes.push({ ...base, field: "cost", store: null, store_code: null, before: dollarsOf(now), after: dollarsOf(parsed.value) });
      }
    }

    const perStore = r["stores"];
    if (perStore != null && (typeof perStore !== "object" || Array.isArray(perStore))) {
      errors.push({ row: i, reason: "bad_row", detail: "stores" });
      return;
    }
    for (const [code, cellRaw] of Object.entries((perStore ?? {}) as Record<string, unknown>)) {
      const store = storeByCode.get(code.trim().toUpperCase());
      if (!store) {
        errors.push({ row: i, reason: "store_not_found", detail: code });
        continue;
      }
      if (!cellRaw || typeof cellRaw !== "object" || Array.isArray(cellRaw)) {
        errors.push({ row: i, reason: "bad_row", detail: code });
        continue;
      }
      const cellIn = cellRaw as Record<string, unknown>;
      const cell = item.stores[store.id];
      const where = { store: store.id, store_code: store.code };
      if ("price" in cellIn) {
        const parsed = parseCellValue("price", cellIn["price"]);
        if ("reason" in parsed) errors.push({ row: i, reason: parsed.reason, detail: `${code}.price` });
        else {
          const exact = cell?.exact === true;
          // The exported book writes the EFFECTIVE price in every cell (bold when
          // exact), so the same figure is "unchanged" whether or not it is fixed —
          // as in the cell itself (typing the shown price writes nothing).
          // Otherwise re-importing the untouched book would pin every price.
          const same = parsed.value === null ? !exact : cell?.price_cents === parsed.value;
          if (same) unchanged++;
          else changes.push({ ...base, field: "price", ...where, before: dollarsOf(cell?.price_cents), after: dollarsOf(parsed.value) });
        }
      }
      if ("discount" in cellIn) {
        const parsed = parseCellValue("discount", cellIn["discount"]);
        if ("reason" in parsed) errors.push({ row: i, reason: parsed.reason, detail: `${code}.discount` });
        else {
          const now = cell?.discount_pct ?? null;
          if (parsed.value === now) unchanged++;
          else changes.push({ ...base, field: "discount", ...where, before: now, after: parsed.value });
        }
      }
    }
  });

  return {
    changes,
    errors,
    counts: {
      rows: list.length,
      changes: changes.length,
      errors: errors.length,
      cost: changes.filter((c) => c.field === "cost").length,
      price: changes.filter((c) => c.field === "price").length,
      discount: changes.filter((c) => c.field === "discount").length,
      unchanged,
    },
  };
}

/**
 * One «Marcas» row: `{ section: "brands", key: <slug>, stores: { <code>: { price, discount } } }`.
 * Same rules as an article: an absent cell is not touched, null empties it, a
 * value already there is `unchanged`. A brand has no cost (`cost` → `bad_row`).
 */
function planBrandImportRow(
  i: number,
  r: Record<string, unknown>,
  index: ImportIndex,
  storeByCode: Map<string, MatrixStore>,
  changes: ImportChange[],
  errors: ImportError[],
  same: () => void
): void {
  const label = typeof r["key"] === "string" ? r["key"].trim().toLowerCase() : "";
  const brand = label ? index.brands?.get(label) : undefined;
  if (!brand) {
    errors.push({ row: i, reason: "unknown_item", detail: label || null });
    return;
  }
  if ("cost" in r && !isBlank(r["cost"])) {
    errors.push({ row: i, reason: "bad_row", detail: "cost" });
    return;
  }
  const perStore = r["stores"];
  if (perStore != null && (typeof perStore !== "object" || Array.isArray(perStore))) {
    errors.push({ row: i, reason: "bad_row", detail: "stores" });
    return;
  }
  const base = { row: i, section: IMPORT_BRAND_SECTION as ImportSection, item: brand.slug, title: brand.label, kind: "brand" as const, key: brand.slug, scope: brand.scope };
  for (const [code, cellRaw] of Object.entries((perStore ?? {}) as Record<string, unknown>)) {
    const store = storeByCode.get(code.trim().toUpperCase());
    if (!store) {
      errors.push({ row: i, reason: "store_not_found", detail: code });
      continue;
    }
    if (!cellRaw || typeof cellRaw !== "object" || Array.isArray(cellRaw)) {
      errors.push({ row: i, reason: "bad_row", detail: code });
      continue;
    }
    const cellIn = cellRaw as Record<string, unknown>;
    const now = brand.stores[store.id] ?? { brand_price_cents: null, brand_discount_pct: null };
    const where = { store: store.id, store_code: store.code };
    if ("price" in cellIn) {
      const parsed = parseCellValue("price", cellIn["price"]);
      if ("reason" in parsed) errors.push({ row: i, reason: parsed.reason, detail: `${code}.price` });
      else if (parsed.value === now.brand_price_cents) same();
      else changes.push({ ...base, field: "price", ...where, before: dollarsOf(now.brand_price_cents), after: dollarsOf(parsed.value) });
    }
    if ("discount" in cellIn) {
      const parsed = parseCellValue("discount", cellIn["discount"]);
      if ("reason" in parsed) errors.push({ row: i, reason: parsed.reason, detail: `${code}.discount` });
      else if (parsed.value === now.brand_discount_pct) same();
      else changes.push({ ...base, field: "discount", ...where, before: now.brand_discount_pct, after: parsed.value });
    }
  }
}

/** The cell write a planned change becomes (its `after` back in the units the cell takes). */
export function changeAsCellWrite(c: ImportChange): CellWriteInput {
  return { kind: c.kind, key: c.key, field: c.field, store: c.store, value: c.after, scope: c.scope };
}

// ── New treatments ───────────────────────────────────────────────────────────

export const AR_GROUPS = ["all", "sv", "bifprog"] as const;

const slugOf = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

/**
 * The `code` of a new treatment, from its label (accents dropped, lower case,
 * dashes): an AR gets `ar-` unless it already starts with it («AR Green Plus»
 * → `ar-green-plus`, «Blue Cut» → `ar-blue-cut`); a photochromic keeps a
 * leading word "photo" / "trans" («Trans Gen 8» → `trans-gen-8`) and
 * otherwise gets `photo-` («Transitions XT» → `photo-transitions-xt`, the
 * same prefix the seeded `photo-grey` / `trans-s-grey` codes use). A code
 * another option already uses gets `-2`, `-3`… Pure.
 */
export function deriveTreatmentCode(type: "photo" | "ar", label: string, taken: ReadonlySet<string>): string {
  const slug = slugOf(label) || type;
  let base: string;
  if (type === "ar") base = slug === "ar" || slug.startsWith("ar-") ? slug : `ar-${slug}`;
  else base = /^(photo|trans)(-|$)/.test(slug) ? slug : `photo-${slug}`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const next = `${base}-${n}`;
    if (!taken.has(next)) return next;
  }
  return `${base}-${Date.now()}`;
}

export interface TreatmentInput {
  type: "photo" | "ar";
  label_es: string;
  label_en: string;
  /** Explicit code; null = derived from the label. */
  code: string | null;
  cost_cents: number | null;
  ar_group: (typeof AR_GROUPS)[number];
  /** photo: cents per category (null = not offered); ar: price_cents in `ar`. */
  prices: { sv: number | null; bifocal: number | null; prog: number | null } | { ar: number };
}

const cleanLabel = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.trim().length <= 80 ? v.trim() : null);

/**
 * Validates `POST /admin/pricing/treatments`. Labels: both or either (the other
 * copies it), up to 80 characters. Prices in dollars. Pure.
 */
export function cleanTreatment(body: Record<string, unknown>): { treatment: TreatmentInput } | { reason: string } {
  const type = body["type"];
  if (type !== "photo" && type !== "ar") return { reason: "bad_type" };
  const es = cleanLabel(body["label_es"]);
  const en = cleanLabel(body["label_en"]);
  if (!es && !en) return { reason: "bad_label" };
  if ((body["label_es"] != null && body["label_es"] !== "" && !es) || (body["label_en"] != null && body["label_en"] !== "" && !en)) return { reason: "bad_label" };
  let code: string | null = null;
  if (!isBlank(body["code"])) {
    const c = String(body["code"]).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(c)) return { reason: "bad_value" };
    code = c;
  }
  const cost = parseCellValue("cost", body["cost"]);
  if ("reason" in cost) return cost;
  const group = isBlank(body["ar_group"]) ? "all" : body["ar_group"];
  if (!AR_GROUPS.includes(group as (typeof AR_GROUPS)[number])) return { reason: "bad_value" };
  const rawPrices = body["prices"];
  let prices: TreatmentInput["prices"];
  if (type === "ar") {
    const p = parseCellValue("price", rawPrices);
    if ("reason" in p || p.value === null) return { reason: "bad_value" };
    prices = { ar: p.value };
  } else {
    if (!rawPrices || typeof rawPrices !== "object" || Array.isArray(rawPrices)) return { reason: "bad_value" };
    const obj = rawPrices as Record<string, unknown>;
    const out: { sv: number | null; bifocal: number | null; prog: number | null } = { sv: null, bifocal: null, prog: null };
    for (const cat of PHOTO_CATEGORIES) {
      const p = parseCellValue("price", obj[cat]);
      if ("reason" in p) return { reason: "bad_value" };
      out[cat] = p.value;
    }
    if (out.sv === null && out.bifocal === null && out.prog === null) return { reason: "bad_value" };
    prices = out;
  }
  return {
    treatment: {
      type,
      label_es: (es ?? en) as string,
      label_en: (en ?? es) as string,
      code,
      cost_cents: cost.value,
      ar_group: group as (typeof AR_GROUPS)[number],
      prices,
    },
  };
}

/** The finish of a base-price row as stored; null on a database without the column. */
export const finishOfRow = (v: unknown): LensFinish | null => parseLensFinish(v);

// ── Editing a treatment (v2) ─────────────────────────────────────────────────

export interface TreatmentPatch {
  label_es?: string;
  label_en?: string;
  ar_group?: (typeof AR_GROUPS)[number];
  /** Cents; null = unknown. */
  cost_cents?: number | null;
  /** photo: only the categories sent (null = no longer offered); ar: `{ ar }`. */
  prices?: Partial<Record<PhotoCategory, number | null>> | { ar: number };
  is_active?: boolean;
}

/**
 * Validates `POST /admin/pricing/treatments/:code` for an option of `type`.
 * Only the keys present change. `prices`: photo → `{ sv?, bifocal?, prog? }`
 * in dollars (null = no longer offered in that category — at least one must
 * stay, checked by the writer against the stored row), ar → a number. Reasons:
 * `bad_label`, `bad_value`, `nothing_to_change`. Pure.
 */
export function cleanTreatmentPatch(type: "photo" | "ar", body: Record<string, unknown>): { patch: TreatmentPatch } | { reason: string } {
  const patch: TreatmentPatch = {};
  for (const key of ["label_es", "label_en"] as const) {
    if (!(key in body)) continue;
    const v = cleanLabel(body[key]);
    if (!v) return { reason: "bad_label" };
    patch[key] = v;
  }
  if ("ar_group" in body) {
    if (type !== "ar" || !AR_GROUPS.includes(body["ar_group"] as (typeof AR_GROUPS)[number])) return { reason: "bad_value" };
    patch.ar_group = body["ar_group"] as (typeof AR_GROUPS)[number];
  }
  if ("cost" in body) {
    const cost = parseCellValue("cost", body["cost"]);
    if ("reason" in cost) return cost;
    patch.cost_cents = cost.value;
  }
  if ("prices" in body) {
    const raw = body["prices"];
    if (type === "ar") {
      const p = parseCellValue("price", raw);
      if ("reason" in p || p.value === null) return { reason: "bad_value" };
      patch.prices = { ar: p.value };
    } else {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { reason: "bad_value" };
      const obj = raw as Record<string, unknown>;
      const out: Partial<Record<PhotoCategory, number | null>> = {};
      for (const cat of PHOTO_CATEGORIES) {
        if (!(cat in obj)) continue;
        const p = parseCellValue("price", obj[cat]);
        if ("reason" in p) return { reason: "bad_value" };
        out[cat] = p.value;
      }
      if (!Object.keys(out).length) return { reason: "bad_value" };
      patch.prices = out;
    }
  }
  if ("is_active" in body) {
    if (typeof body["is_active"] !== "boolean") return { reason: "bad_value" };
    patch.is_active = body["is_active"];
  }
  if (!Object.keys(patch).length) return { reason: "nothing_to_change" };
  return { patch };
}

/** The photochromic's categories after a patch: at least one must keep a price. Pure. */
export function photoPricesAfter(
  current: Record<PhotoCategory, number | null>,
  patch: Partial<Record<PhotoCategory, number | null>>
): Record<PhotoCategory, number | null> | null {
  const next = { ...current, ...patch };
  return next.sv === null && next.bifocal === null && next.prog === null ? null : next;
}
