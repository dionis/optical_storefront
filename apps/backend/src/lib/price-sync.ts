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
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";
import { sellingPrice, normalizeModel, type PriceKind } from "./pricing";
import { PRICE_BOOK, type PriceBookItem } from "../data/wholesale-prices";

export type SyncReport = {
  total: number;
  updated: number;
  unchanged: number;
  unmatched: string[]; // catalog products with no sheet price (title)
  estimatedUsed: number; // matched via brand-average estimate (no wholesale)
  currency: string;
};

const CURRENCY = "usd";

/** Build the lookup once: normalized model -> target selling price (whole dollars). */
function buildIndex(): Map<string, { price: number; estimated: boolean }> {
  const items: PriceBookItem[] = PRICE_BOOK;
  const idx = new Map<string, { price: number; estimated: boolean }>();
  for (const it of items) {
    const kind: PriceKind = it.brand.toLowerCase() === "cases" ? "case" : "frame";
    // Recompute from wholesale when we have it (keeps the rule authoritative);
    // fall back to the sheet's estimated price when the wholesale is unknown.
    const price = it.wholesale != null ? sellingPrice(it.wholesale, kind) : it.price;
    idx.set(it.key, { price, estimated: it.wholesale == null });
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

  const report: SyncReport = {
    total: 0,
    updated: 0,
    unchanged: 0,
    unmatched: [],
    estimatedUsed: 0,
    currency: CURRENCY,
  };

  const pageSize = 200;
  let offset = 0;
  // We set the target price on every matched variant (idempotent — writing the
  // same amount is harmless). We deliberately do NOT read the current variant
  // price here: in Medusa v2 the amount lives on a price set linked to the
  // variant, and the exact query path is version-sensitive; setting the target
  // unconditionally is simpler and safe to run every few hours.
  const updates: { id: string; prices: { amount: number; currency_code: string }[] }[] = [];

  for (;;) {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "variants.id"],
      pagination: { skip: offset, take: pageSize },
    });
    if (!products || products.length === 0) break;

    for (const p of products) {
      report.total++;
      const hit = index.get(normalizeModel(p.title as string));
      if (!hit) {
        report.unmatched.push(p.title as string);
        continue;
      }
      if (hit.estimated) report.estimatedUsed++;
      for (const v of (p.variants as any[]) || []) {
        report.updated++;
        updates.push({
          id: v.id,
          prices: [{ amount: hit.price, currency_code: CURRENCY }],
        });
      }
    }
    offset += products.length;
    if (products.length < pageSize) break;
  }

  logger.info(
    `[price-sync] scanned ${report.total} products; ${report.updated} variant prices to update, ` +
      `${report.unchanged} already correct, ${report.unmatched.length} without a sheet price` +
      (opts.dryRun ? " (DRY RUN — no writes)" : "")
  );

  if (!opts.dryRun && updates.length) {
    // Update in batches so a huge catalog does not build one giant transaction.
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      await updateProductVariantsWorkflow(container).run({
        input: { product_variants: batch as any },
      });
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
