/**
 * WHAT THE WEB SHOP CHARGES — the online store's prices (lib/online-store.ts).
 *
 * Until now the web sold at the master list: a variant's Medusa price plus the
 * master lens matrix. The owner manages the web shop as a store of the panel
 * (Op4), so the web must charge what that store's column says in «Productos y
 * precios»: its exact prices, its brand prices, its adjustment and band, its
 * own lens cells and "% sobre el maestro", and its promotions — exactly the
 * figures the till quotes for that store (`quoteSale`, lib/pos-data.ts), built
 * from the same pure functions so the two cannot drift apart.
 *
 * Three callers, one context:
 *   - the catalogue (GET /store/products…): every variant's `calculated_price`
 *     is rewritten to the store's price (`rewriteProductPrices`);
 *   - the lens wizard (GET /store/lens-config/matrix, POST …/quote);
 *   - the cart (POST /store/carts/:id/configured-line and …/revalidate), where
 *     the price is decided — never by the browser.
 *
 * With no online store `webPriceContext` answers null and every caller keeps
 * the master behaviour it had.
 *
 * Not applied on purpose (v1): the store's assortment. What the web lists is
 * what is published in its sales channel; hiding models per store there would
 * break the catalogue's pagination and counts.
 */
import type { Knex } from "@mikro-orm/knex";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { loadProductMetadata } from "./frame-specs";
import { computeLensBreakdown, type LensSelection } from "./lens-quote";
import { onlineStore, type OnlineStore } from "./online-store";
import {
  applyPct,
  caseProductIdsOf,
  linePromoPcts,
  metadataSaysCase,
  NO_PROMO,
  productDiscountOf,
  promoStoreLine,
  type DiscountIndex,
  type LinePromo,
} from "./price-matrix";
import { storeDiscountIndex } from "./price-matrix-data";
import { brandOf } from "./store-assortment";
import { storeLinePrice, type PriceRuleLike } from "./store-pricing";
import { openRules } from "./store-pricing-data";

const toCents = (v: number) => Math.round(v * 100);

export interface WebPriceContext {
  store: OnlineStore;
  rules: PriceRuleLike[];
  discounts: DiscountIndex;
  /** Products the owner priced as cases in a rule this store can see. */
  caseIds: ReadonlySet<string>;
}

/** The online store's rules and promotions, or null when there is no online store. */
export async function webPriceContext(container: MedusaContainer): Promise<WebPriceContext | null> {
  const store = await onlineStore(container);
  if (!store) return null;
  const [rules, discounts] = await Promise.all([openRules(container, [store.id]), storeDiscountIndex(container, [store.id])]);
  return { store, rules, discounts, caseIds: caseProductIdsOf(rules) };
}

export interface WebProductRef {
  id: string;
  metadata?: Record<string, unknown> | null;
}

const scopeOf = (ctx: WebPriceContext, p: WebProductRef): "frame" | "case" => (ctx.caseIds.has(p.id) || metadataSaysCase(p.metadata) ? "case" : "frame");

export interface WebProductPrice {
  /** What the web shows and charges, in dollars. */
  price: number;
  /** The store's price before its promotion, in dollars (= `price` without one). */
  before: number;
  /** The promotion, in %; null without one. */
  discount_pct: number | null;
}

/**
 * A frame's (or case's) price in the online store: the store's price of the
 * model, then its own % off. `base` is the model's Medusa price. Pure.
 */
export function webProductPrice(ctx: WebPriceContext, product: WebProductRef, base: number, now = new Date()): WebProductPrice {
  const brand = brandOf(product.metadata) || null;
  const priced = storeLinePrice(ctx.rules, { establishmentId: ctx.store.id, scope: scopeOf(ctx, product), target: product.id, base, lenses: 0, brand }, now);
  const pct = productDiscountOf(ctx.discounts, ctx.store.id, product.id, brand);
  const price = applyPct(toCents(priced.total), pct) / 100;
  return { price, before: priced.total, discount_pct: price < priced.total ? pct : null };
}

export interface WebLensParts {
  lens_base_cents: number;
  photo_cents: number;
  ar_cents: number;
}

export interface WebLinePrice {
  /** The frame after the store's promotion, in dollars. */
  frame: number;
  /** The lens add-on after the store's promotion, in cents. */
  lens_cents: number;
  /** The promotion that applied (what the till stores on a line too); null without one. */
  promo: LinePromo | null;
}

/**
 * One line of the web cart in the online store: the frame and its lenses, with
 * the store's promotion on each part — `promoStoreLine`, the function the till
 * uses. `lens` is the store's own breakdown (`computeLensBreakdown` with the
 * store). Pure.
 */
export function webLinePrice(
  ctx: WebPriceContext,
  line: { product: WebProductRef; base: number; selection: LensSelection; lens: WebLensParts; category: string | null; finish: Parameters<typeof linePromoPcts>[2]["finish"] },
  now = new Date()
): WebLinePrice {
  const brand = brandOf(line.product.metadata) || null;
  const pcts = ctx.discounts.size
    ? linePromoPcts(ctx.discounts, ctx.store.id, { productId: line.product.id, brandSlug: brand, selection: line.selection, category: line.category, finish: line.finish })
    : NO_PROMO;
  const sp = promoStoreLine(ctx.rules, { establishmentId: ctx.store.id, scope: scopeOf(ctx, line.product), target: line.product.id, brand, base: line.base, lens: line.lens }, pcts, now);
  return { frame: sp.frame, lens_cents: toCents(sp.lenses), promo: sp.promo };
}

/**
 * The lens add-on alone in the online store (the wizard's running total: the
 * browser already holds the frame's price). Each part carries the store's
 * price and its promotion; the legacy store-wide adjustment that also covers
 * lenses lands on the base cell so the three parts always add up. Pure.
 */
export function webLensParts(
  ctx: WebPriceContext,
  input: { selection: LensSelection; lens: WebLensParts; category: string | null; finish: Parameters<typeof linePromoPcts>[2]["finish"] },
  now = new Date()
): WebLensParts & { total_cents: number } {
  const pcts = ctx.discounts.size
    ? linePromoPcts(ctx.discounts, ctx.store.id, { productId: null, selection: input.selection, category: input.category, finish: input.finish })
    : NO_PROMO;
  const sp = promoStoreLine(ctx.rules, { establishmentId: ctx.store.id, scope: "frame", target: "", base: 0, lens: input.lens }, pcts, now);
  const total = toCents(sp.lenses);
  const photo = applyPct(input.lens.photo_cents, pcts.photo_pct);
  const ar = applyPct(input.lens.ar_cents, pcts.ar_pct);
  return { lens_base_cents: Math.max(0, total - photo - ar), photo_cents: photo, ar_cents: ar, total_cents: total };
}

const pgOf = (container: MedusaContainer): Knex => container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/**
 * Prices one configured line of the web cart in the online store. `base` is
 * the variant's own Medusa price (what the web charged before), so a store
 * with no rule and no promotion charges exactly what the master did. Throws
 * what `computeLensBreakdown` throws (unknown design, option not offered).
 */
export async function quoteWebLine(
  container: MedusaContainer,
  ctx: WebPriceContext,
  input: { productId: string; base: number; selection: LensSelection }
): Promise<WebLinePrice> {
  const pg = pgOf(container);
  const [b, metadata] = await Promise.all([computeLensBreakdown(pg, input.selection, ctx.store.id), loadProductMetadata(pg, [input.productId])]);
  return webLinePrice(ctx, {
    product: { id: input.productId, metadata: metadata.get(input.productId) ?? null },
    base: input.base,
    selection: input.selection,
    lens: { lens_base_cents: b.lens_base_cents, photo_cents: b.photo_cents, ar_cents: b.ar_cents },
    category: b.category,
    finish: b.finish,
  });
}

/** The lens add-on of a wizard selection in the online store (see `webLensParts`). */
export async function quoteWebLens(container: MedusaContainer, ctx: WebPriceContext, selection: LensSelection): Promise<WebLensParts & { total_cents: number }> {
  const b = await computeLensBreakdown(pgOf(container), selection, ctx.store.id);
  return webLensParts(ctx, { selection, lens: { lens_base_cents: b.lens_base_cents, photo_cents: b.photo_cents, ar_cents: b.ar_cents }, category: b.category, finish: b.finish });
}

// ── The catalogue ────────────────────────────────────────────────────────────

/** A Medusa `calculated_price` as the store API returns it (only what is rewritten). */
type CalculatedPrice = Record<string, unknown> & { calculated_amount?: number | null; original_amount?: number | null };
interface CatalogVariant {
  calculated_price?: CalculatedPrice | null;
}
interface CatalogProduct {
  id?: string;
  metadata?: Record<string, unknown> | null;
  variants?: CatalogVariant[] | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Moves a tax-inclusive / tax-exclusive sibling of an amount by the same proportion as the amount itself. */
function rescale(cp: CalculatedPrice, keys: readonly string[], from: number, to: number): void {
  for (const k of keys) {
    const v = cp[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    cp[k] = from > 0 ? round2((v * to) / from) : to;
  }
}

/**
 * Rewrites, in place, the `calculated_price` of every variant of `products` to
 * the online store's price: `calculated_amount` is what the shopper pays and
 * `original_amount` the store's price before its promotion (Medusa's own
 * meaning of the pair, so a storefront that shows a crossed-out price keeps
 * working). A variant without a calculated price is left alone — it does not
 * price for the region, and the store's rules must not invent one. Pure.
 *
 * Returns how many variants changed figure.
 */
export function applyWebPrices(ctx: WebPriceContext, products: CatalogProduct[], metadataById: ReadonlyMap<string, Record<string, unknown>> = new Map(), now = new Date()): number {
  let changed = 0;
  for (const p of products) {
    if (!p?.id || !Array.isArray(p.variants)) continue;
    const ref: WebProductRef = { id: p.id, metadata: p.metadata ?? metadataById.get(p.id) ?? null };
    for (const v of p.variants) {
      const cp = v?.calculated_price;
      const base = cp?.calculated_amount;
      if (!cp || typeof base !== "number" || !Number.isFinite(base)) continue;
      const priced = webProductPrice(ctx, ref, base, now);
      const original = typeof cp.original_amount === "number" && Number.isFinite(cp.original_amount) ? cp.original_amount : base;
      if (toCents(priced.price) === toCents(base) && toCents(priced.before) === toCents(original)) continue;
      changed += 1;
      rescale(cp, ["calculated_amount_with_tax", "calculated_amount_without_tax"], base, priced.price);
      rescale(cp, ["original_amount_with_tax", "original_amount_without_tax"], original, priced.before);
      cp.calculated_amount = priced.price;
      cp.original_amount = priced.before;
    }
  }
  return changed;
}

/** The products of a store-API body: `{ products: [...] }` or `{ product: {...} }`. */
export function productsOfBody(body: unknown): CatalogProduct[] {
  if (!body || typeof body !== "object") return [];
  const b = body as { products?: unknown; product?: unknown };
  if (Array.isArray(b.products)) return b.products as CatalogProduct[];
  if (b.product && typeof b.product === "object") return [b.product as CatalogProduct];
  return [];
}

/**
 * The catalogue as the online store sells it: rewrites the prices of a
 * GET /store/products… body in place. No online store, or a body with no
 * priced variant: untouched, and no query is made.
 */
export async function rewriteProductPrices(container: MedusaContainer, body: unknown): Promise<number> {
  const products = productsOfBody(body).filter((p) => p?.id && (p.variants ?? []).some((v) => typeof v?.calculated_price?.calculated_amount === "number"));
  if (!products.length) return 0;
  const ctx = await webPriceContext(container);
  if (!ctx) return 0;
  // The brand (its price and its discount) and the "case" word live in the
  // product's metadata: read it for the products whose body does not carry it.
  const missing = products.filter((p) => p.metadata == null).map((p) => String(p.id));
  const metadataById = missing.length ? await loadProductMetadata(pgOf(container), missing) : new Map<string, Record<string, unknown>>();
  return applyWebPrices(ctx, products, metadataById);
}
