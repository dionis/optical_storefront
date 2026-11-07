/**
 * QA catalog seed — a realistic, LOCAL-ONLY stack to exercise the whole panel
 * end to end (store, USD region, sales channel, a slice of the real catalog).
 *
 *   QA_SEED_CONFIRM=yes npx medusa exec src/scripts/seed-qa-catalog.ts
 *
 * Why it exists: `medusa db:migrate` on an empty database leaves no store
 * currency, no region, no sales channel and no products, so the point of sale
 * cannot even quote a frame. The scraper fills the catalog in staging and
 * production, but it needs caprioptics.com and R2; for a QA run (CI, a laptop,
 * a browser-driven walkthrough) we only need enough real-looking frames and
 * cases to click through every screen.
 *
 * Safety: it refuses to run unless DATABASE_URL points at localhost/127.0.0.1
 * AND QA_SEED_CONFIRM=yes — it must never touch staging or production, where
 * the catalog belongs to the scraper (apps/scraper/scraper/medusa_push.py).
 * Idempotent: products are matched by handle and skipped when present.
 *
 * Shapes mirror medusa_push.py (options, variants, metadata keys) so the POS,
 * the assortment rules (brand_slug), the price book (sku) and the frame cards
 * (brand, measures, images) see what they see with the real catalog.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createStoresWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { sellingPrice } from "../lib/pricing";
import { capriCostCents } from "../modules/store-pricing/capri-price-list-2026";

const PER_BRAND = Number(process.env.QA_SEED_PER_BRAND ?? 8);
const CASES = Number(process.env.QA_SEED_CASES ?? 5);

interface CatalogColor { name: string; image?: string }
interface CatalogItem {
  sku: string;
  name: string;
  brand: string;
  brand_slug: string;
  colors?: CatalogColor[];
  attributes?: Record<string, unknown>;
}

function assertLocal(): void {
  const url = process.env.DATABASE_URL ?? "";
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  if (!local) throw new Error(`seed-qa-catalog: refusing — DATABASE_URL is not a local database (${url.replace(/:[^:@]*@/, ":***@")})`);
  if (process.env.QA_SEED_CONFIRM !== "yes") throw new Error("seed-qa-catalog: set QA_SEED_CONFIRM=yes to run");
}

function loadJson<T>(rel: string): T {
  const path = resolve(__dirname, "../../../capri-storefront/public", rel);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** "51-53 mm" → 51; null when unknown. */
const firstMm = (v: unknown): number | null => {
  const m = String(v ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

export default async function seedQaCatalog({ container }: { container: MedusaContainer }): Promise<void> {
  assertLocal();
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // ── Store, currency, region, sales channel ────────────────────────────────
  const storeModule = container.resolve(Modules.STORE);
  let [store] = await storeModule.listStores({}, { take: 1 });
  if (!store) {
    const { result } = await createStoresWorkflow(container).run({ input: { stores: [{ name: "QA Store", supported_currencies: [{ currency_code: "usd", is_default: true }] }] } });
    store = result[0];
    logger.info("[qa-seed] store created");
  }

  const { data: regions } = await query.graph({ entity: "region", fields: ["id", "currency_code"] });
  let regionId = (regions as Array<{ id: string; currency_code: string }>).find((r) => r.currency_code === "usd")?.id;
  if (!regionId) {
    const { result } = await createRegionsWorkflow(container).run({
      input: { regions: [{ name: "United States", currency_code: "usd", countries: ["us"], payment_providers: ["pp_manual_manual", "pp_system_default"] }] },
    });
    regionId = result[0].id;
    logger.info("[qa-seed] USD region created");
  }

  const { data: channels } = await query.graph({ entity: "sales_channel", fields: ["id", "name"] });
  let channelId = (channels as Array<{ id: string; name: string }>).find((c) => c.name === "Default Sales Channel")?.id;
  if (!channelId) {
    const { result } = await createSalesChannelsWorkflow(container).run({ input: { salesChannelsData: [{ name: "Default Sales Channel", description: "Web store" }] } });
    channelId = result[0].id;
    logger.info("[qa-seed] default sales channel created");
  }
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: { supported_currencies: [{ currency_code: "usd", is_default: true }], default_sales_channel_id: channelId, default_region_id: regionId },
    },
  });

  // ── Products: a slice per brand + a few cases ─────────────────────────────
  const catalog = loadJson<CatalogItem[]>("catalog.json");
  const cases = loadJson<CatalogItem[]>("cases.json");
  const byBrand = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    const list = byBrand.get(item.brand_slug) ?? [];
    if (list.length < PER_BRAND) list.push(item);
    byBrand.set(item.brand_slug, list);
  }
  const picked = [...[...byBrand.values()].flat(), ...cases.slice(0, CASES)];

  const { data: existing } = await query.graph({ entity: "product", fields: ["handle"] });
  const have = new Set((existing as Array<{ handle: string }>).map((p) => p.handle));
  // "GR 829" / "CASE C-26" → "gr-829" / "case-c-26": the scraper's handle rule.
  const handleOf = (sku: string): string => sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const products = picked
    .filter((item) => !have.has(handleOf(item.sku)))
    .map((item) => {
      const isCase = cases.includes(item);
      const colors = item.colors?.length ? item.colors : [{ name: "Default" }];
      const cost = capriCostCents(item.sku) ?? (isCase ? 150 : 900);
      const price = sellingPrice(cost, isCase ? "case" : "frame") / 100;
      const a = item.attributes ?? {};
      return {
        title: item.name,
        handle: handleOf(item.sku),
        status: "published" as const,
        options: [{ title: "Color", values: colors.map((c) => c.name) }],
        variants: colors.map((c, idx) => ({
          title: c.name,
          sku: idx === 0 ? item.sku : `${item.sku}-${handleOf(c.name)}`,
          options: { Color: c.name },
          manage_inventory: false,
          prices: [{ currency_code: "usd", amount: price }],
          metadata: { color: c.name, image: c.image ?? null },
        })),
        images: colors.filter((c) => c.image).map((c) => ({ url: c.image as string })),
        thumbnail: colors.find((c) => c.image)?.image ?? null,
        sales_channels: [{ id: channelId as string }],
        metadata: {
          brand: item.brand,
          brand_slug: item.brand_slug,
          collection_slug: item.brand_slug,
          kind: isCase ? "case" : "frame",
          eye_size: firstMm(a.eye_size),
          bridge_size: firstMm(a.bridge_size),
          temple_length: firstMm(a.temple_length),
          material: a.material ?? null,
          shape: a.shape ?? null,
          style: a.style ?? null,
          gender: a.gender ?? null,
          age_group: a.age ?? null,
          first_seen_at: new Date().toISOString(),
        },
      };
    });

  if (!products.length) {
    logger.info(`[qa-seed] nothing to add (${have.size} products already present)`);
    return;
  }
  await createProductsWorkflow(container).run({ input: { products } });
  logger.info(`[qa-seed] ${products.length} products created (${byBrand.size} brands, ${Math.min(CASES, cases.length)} cases)`);
}
