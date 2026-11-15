/**
 * Copies the frame catalog of another backend of this repo into this one
 * (terminal of the NEW optician's backend):
 *
 *   CATALOG_SOURCE_URL=https://api.<source> CATALOG_SOURCE_KEY=sk_... \
 *     npx medusa exec ./src/scripts/copy-catalog.js
 *       → dry run: what it would create
 *   … COPY_CATALOG_CONFIRM=yes npx medusa exec ./src/scripts/copy-catalog.js
 *       → creates the missing products
 *
 * Why not the scraper: a new optician that sells the same supplier needs the
 * same products, and the source's bucket already holds every photo and the AI
 * views (`media/frame-media.json`). The scraper would download them again and
 * PUT every image into whatever bucket it is given — with the source's
 * credentials that is writing into another store's production files.
 *
 * What this does instead: READS the source's products through its Admin API
 * (only GET requests; a secret API key of the source, revoke it afterwards) and
 * creates them here with the SAME handle, SKUs, options, prices and metadata,
 * and the SAME image keys. Keys are bare (`products/<handle>/…webp`) and the
 * storefront resolves them against VITE_R2_PUBLIC_URL, so pointing this
 * optician's storefront at the source bucket's PUBLIC url shows the photos and
 * the views. Nothing here needs, or writes with, the source's storage
 * credentials.
 *
 * Idempotent: products whose handle already exists here are skipped. Only
 * published products unless COPY_CATALOG_DRAFTS=yes. COPY_CATALOG_LIMIT caps
 * how many are created (for a first test).
 */
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createProductsWorkflow } from "@medusajs/medusa/core-flows";

const PAGE = 50;
const BATCH = 25;
const FIELDS = [
  "id", "title", "subtitle", "description", "handle", "status", "thumbnail", "metadata",
  "discountable", "weight", "length", "height", "width", "material", "origin_country",
  "*images", "*options", "*options.values",
  "*variants", "*variants.prices", "*variants.options",
].join(",");

interface SrcOption { id: string; title: string; values?: Array<{ value: string }> }
interface SrcVariant {
  title: string;
  sku?: string | null;
  ean?: string | null;
  upc?: string | null;
  barcode?: string | null;
  manage_inventory?: boolean;
  allow_backorder?: boolean;
  weight?: number | null;
  metadata?: Record<string, unknown> | null;
  prices?: Array<{ amount: number; currency_code: string; rules?: Record<string, unknown> | null; price_rules?: unknown[] }>;
  options?: Array<{ value: string; option_id?: string | null; option?: { id?: string; title?: string } | null }>;
}
interface SrcProduct {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  handle: string;
  status: string;
  thumbnail?: string | null;
  metadata?: Record<string, unknown> | null;
  discountable?: boolean;
  weight?: number | null;
  length?: number | null;
  height?: number | null;
  width?: number | null;
  material?: string | null;
  origin_country?: string | null;
  images?: Array<{ url: string }>;
  options?: SrcOption[];
  variants?: SrcVariant[];
}

const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};

async function fetchAll(source: string, key: string): Promise<SrcProduct[]> {
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  const out: SrcProduct[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${source}/admin/products?limit=${PAGE}&offset=${offset}&fields=${encodeURIComponent(FIELDS)}`;
    const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" } });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(`source answered ${res.status} for /admin/products (offset ${offset}): ${body}`);
    }
    const page = (await res.json()) as { products?: SrcProduct[]; count?: number };
    const items = page.products ?? [];
    out.push(...items);
    if (items.length < PAGE || (page.count != null && out.length >= page.count)) return out;
  }
}

/** Plain prices only (no price-list or rule-bound ones), one per currency. */
function pricesOf(v: SrcVariant): Array<{ amount: number; currency_code: string }> {
  const seen = new Map<string, number>();
  for (const p of v.prices ?? []) {
    const ruled = (p.rules && Object.keys(p.rules).length > 0) || (p.price_rules?.length ?? 0) > 0;
    if (ruled || seen.has(p.currency_code)) continue;
    seen.set(p.currency_code, Number(p.amount));
  }
  return [...seen].map(([currency_code, amount]) => ({ currency_code, amount }));
}

function toInput(p: SrcProduct, channelId: string) {
  const optionTitle = new Map((p.options ?? []).map((o) => [o.id, o.title]));
  return {
    title: p.title,
    subtitle: p.subtitle ?? undefined,
    description: p.description ?? undefined,
    handle: p.handle,
    status: p.status as "published" | "draft",
    thumbnail: p.thumbnail ?? undefined,
    metadata: p.metadata ?? undefined,
    discountable: p.discountable,
    weight: p.weight ?? undefined,
    length: p.length ?? undefined,
    height: p.height ?? undefined,
    width: p.width ?? undefined,
    material: p.material ?? undefined,
    origin_country: p.origin_country ?? undefined,
    images: (p.images ?? []).map((i) => ({ url: i.url })),
    options: (p.options ?? []).map((o) => ({ title: o.title, values: (o.values ?? []).map((v) => v.value) })),
    variants: (p.variants ?? []).map((v) => ({
      title: v.title,
      sku: v.sku ?? undefined,
      ean: v.ean ?? undefined,
      upc: v.upc ?? undefined,
      barcode: v.barcode ?? undefined,
      manage_inventory: v.manage_inventory ?? false,
      allow_backorder: v.allow_backorder ?? false,
      weight: v.weight ?? undefined,
      metadata: v.metadata ?? undefined,
      prices: pricesOf(v),
      options: Object.fromEntries(
        (v.options ?? []).map((o) => [o.option?.title ?? optionTitle.get(o.option_id ?? "") ?? "Color", o.value]),
      ),
    })),
    sales_channels: [{ id: channelId }],
  };
}

export default async function run({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const log = (m: string) => logger.info(`[copy-catalog] ${m}`);
  const fail = (m: string) => {
    logger.error(`[copy-catalog] ${m}`);
    process.exitCode = 1;
  };

  const source = (process.env.CATALOG_SOURCE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.CATALOG_SOURCE_KEY ?? "").trim();
  const confirm = process.env.COPY_CATALOG_CONFIRM === "yes";
  const drafts = process.env.COPY_CATALOG_DRAFTS === "yes";
  const limit = Number(process.env.COPY_CATALOG_LIMIT ?? 0) || Infinity;

  if (!/^https:\/\//.test(source)) return fail("CATALOG_SOURCE_URL must be the source backend's https URL.");
  if (!/^sk_/.test(key)) return fail("CATALOG_SOURCE_KEY must be a secret API key (sk_…) of the SOURCE backend.");
  if (origin(source) === origin(process.env.BACKEND_URL ?? "")) return fail("The source is this same backend.");

  const [store] = await container.resolve(Modules.STORE).listStores({}, { take: 1 });
  const channelId = store?.default_sales_channel_id;
  if (!channelId) return fail("This store has no default sales channel: run tenant-seed first.");

  log(`reading ${source} …`);
  const all = await fetchAll(source, key);
  const wanted = all.filter((p) => drafts || p.status === "published");
  const { data: existing } = await query.graph({ entity: "product", fields: ["handle"] });
  const have = new Set((existing as Array<{ handle: string }>).map((p) => p.handle));
  const todo = wanted.filter((p) => !have.has(p.handle)).slice(0, limit);

  const sample = todo.find((p) => p.thumbnail)?.thumbnail ?? "(none)";
  log(`source: ${all.length} products (${wanted.length} ${drafts ? "incl. drafts" : "published"}); here: ${have.size}; to create: ${todo.length}`);
  log(`image keys look like: ${sample}`);
  if (/^https?:\/\//.test(sample)) log("note: absolute image URLs are kept as they are.");
  else log("note: bare image keys — set VITE_R2_PUBLIC_URL (storefront) and R2_PUBLIC_URL (backend) to the source bucket's PUBLIC url.");

  if (!confirm) {
    logger.warn("[copy-catalog] Dry run. To create them add COPY_CATALOG_CONFIRM=yes (and COPY_CATALOG_LIMIT=5 for a first test).");
    return;
  }

  let created = 0;
  const failed: string[] = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    try {
      await createProductsWorkflow(container).run({ input: { products: batch.map((p) => toInput(p, channelId)) } });
      created += batch.length;
    } catch (e) {
      // One bad product must not lose the whole batch: retry it one by one.
      for (const p of batch) {
        try {
          await createProductsWorkflow(container).run({ input: { products: [toInput(p, channelId)] } });
          created += 1;
        } catch (err) {
          failed.push(`${p.handle}: ${(err as Error).message.slice(0, 160)}`);
        }
      }
    }
    log(`${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  log(`created ${created}; failed ${failed.length}`);
  for (const f of failed.slice(0, 20)) logger.warn(`[copy-catalog] ${f}`);
  if (failed.length) process.exitCode = 1;
}
