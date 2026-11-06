/**
 * Price synchronisation: bring every catalog product's price in line with the
 * real wholesale price sheet + the pricing rules (src/lib/pricing.ts).
 *
 * Source of truth: src/data/wholesale-prices.json (derived from Capri's wholesale
 * sheets — the supplier's prices are login-gated and cannot be scraped). Products
 * are matched to a sheet row by their normalized model name (the product title).
 *
 * This is idempotent: it recomputes the target selling price and writes it to each
 * variant's USD price. Running it repeatedly (e.g. the 4-hourly job) keeps prices
 * stable and consistent with the catalog, and surfaces any catalog model that has
 * no sheet price (a newly added frame) so it can be priced.
 *
 * The owner's own price for a model (a global price rule, src/lib/store-pricing.ts)
 * wins over the sheet: without this the 4-hourly run would put back the
 * wholesale-derived price a few hours after the owner set theirs.
 *
 * The CHAIN's price band (src/lib/pricing.ts) is applied to the converted
 * price before it is written — the floor raises what the conversion priced too
 * low, the ceiling brings down what it priced too high — and never to a price
 * the owner typed himself. Only the chain's band: a Medusa variant holds ONE
 * price, so a per-store band cannot live here; it is applied per store when
 * the line is quoted (`storeLinePrice`).
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import {
  applyPriceBandUsd,
  normalizeModel,
  priceBandFor,
  sellingPrice,
  type BandImpactItem,
  type PriceBand,
  type PriceKind,
} from "./pricing";
import { PRICE_BOOK, type PriceBookItem } from "../data/wholesale-prices";
import { openRules, setVariantPrices, type VariantPriceUpdate } from "./store-pricing-data";
import { globalPriceOverrides } from "./store-pricing";

export type SyncReport = {
  total: number;
  updated: number;
  unchanged: number;
  unmatched: string[]; // catalog products with no sheet price (title)
  estimatedUsed: number; // matched via brand-average estimate (no wholesale)
  ownerPriced: number; // products priced by the owner's own global price
  bandRaised: number; // products the chain's floor lifted
  bandLowered: number; // products the chain's ceiling brought down
  currency: string;
};

const CURRENCY = "usd";

/**
 * THE CONVERTED PRICE of every model in the supplier's price book, before any
 * band: the wholesale cost run through `sellingPrice`, or the sheet's own
 * figure for a model the supplier does not list.
 *
 * This is the one definition of "el precio después de conversión", so the
 * 4-hourly job and the panel's impact preview cannot disagree about what a
 * floor or a ceiling would move.
 */
export function convertedPriceBook(items: readonly PriceBookItem[] = PRICE_BOOK): BandImpactItem[] {
  return items.map((it) => {
    const kind: PriceKind = it.brand.toLowerCase() === "cases" ? "case" : "frame";
    // Recompute from wholesale when we have it (keeps the rule authoritative);
    // fall back to the sheet's estimated price when the wholesale is unknown.
    return {
      key: it.key,
      model: it.model,
      kind,
      price: it.wholesale != null ? sellingPrice(it.wholesale, kind) : it.price,
    };
  });
}

/** Build the lookup once: normalized model -> target selling price (whole dollars). */
function buildIndex(): Map<string, { price: number; estimated: boolean; kind: PriceKind }> {
  const idx = new Map<string, { price: number; estimated: boolean; kind: PriceKind }>();
  const converted = new Map(convertedPriceBook().map((c) => [c.key, c]));
  for (const it of PRICE_BOOK) {
    const hit = converted.get(it.key);
    if (!hit) continue;
    idx.set(it.key, { price: hit.price, estimated: it.wholesale == null, kind: hit.kind });
  }
  return idx;
}

export async function syncPrices(
  container: MedusaContainer,
  opts: { dryRun?: boolean } = {}
): Promise<SyncReport> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const index = buildIndex();
  // `openRules` is also what warms the band cache, so the chain's band is in
  // hand by the time the first price is computed (lib/store-pricing-data.ts).
  const ownerPrices = globalPriceOverrides(await openRules(container, []));
  const band: PriceBand | null = priceBandFor(null);

  const report: SyncReport = {
    total: 0,
    updated: 0,
    unchanged: 0,
    unmatched: [],
    estimatedUsed: 0,
    ownerPriced: 0,
    bandRaised: 0,
    bandLowered: 0,
    currency: CURRENCY,
  };

  const pageSize = 200;
  let offset = 0;
  // We set the target price on every matched variant (idempotent — writing the
  // same amount is harmless). We deliberately do NOT read the current variant
  // price here: in Medusa v2 the amount lives on a price set linked to the
  // variant, and the exact query path is version-sensitive; setting the target
  // unconditionally is simpler and safe to run every few hours.
  const updates: VariantPriceUpdate[] = [];

  for (;;) {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "variants.id"],
      pagination: { skip: offset, take: pageSize },
    });
    if (!products || products.length === 0) break;

    for (const p of products) {
      report.total++;
      const owner = ownerPrices.get(p.id as string);
      if (owner != null) {
        report.ownerPriced++;
        for (const v of (p.variants as any[]) || []) {
          report.updated++;
          updates.push({ variant_id: v.id, product_id: p.id as string, prices: [{ amount: owner, currency_code: CURRENCY }] });
        }
        continue;
      }
      const hit = index.get(normalizeModel(p.title as string));
      if (!hit) {
        report.unmatched.push(p.title as string);
        continue;
      }
      if (hit.estimated) report.estimatedUsed++;
      // The floor and the ceiling, last and on the converted price only: a
      // price the owner typed took the branch above and never gets here.
      const amount = applyPriceBandUsd(hit.price, band, hit.kind);
      if (amount > hit.price) report.bandRaised++;
      else if (amount < hit.price) report.bandLowered++;
      for (const v of (p.variants as any[]) || []) {
        report.updated++;
        updates.push({
          variant_id: v.id,
          product_id: p.id as string,
          prices: [{ amount, currency_code: CURRENCY }],
        });
      }
    }
    offset += products.length;
    if (products.length < pageSize) break;
  }

  logger.info(
    `[price-sync] scanned ${report.total} products (${report.ownerPriced} at the owner's own price, ` +
      `${report.bandRaised} lifted by the floor, ${report.bandLowered} brought down by the ceiling); ` +
      `${report.updated} variant prices to update, ` +
      `${report.unchanged} already correct, ${report.unmatched.length} without a sheet price` +
      (opts.dryRun ? " (DRY RUN — no writes)" : "")
  );

  if (!opts.dryRun && updates.length) {
    // Update in batches so a huge catalog does not build one giant transaction.
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      await setVariantPrices(container, updates.slice(i, i + batchSize));
      logger.info(`[price-sync] updated ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
    }
  }

  if (report.unmatched.length) {
    logger.warn(
      `[price-sync] ${report.unmatched.length} catalog products have no wholesale sheet price ` +
        `(need pricing): ${report.unmatched.slice(0, 20).join(", ")}` +
        (report.unmatched.length > 20 ? " …" : "")
    );
  }
  return report;
}
