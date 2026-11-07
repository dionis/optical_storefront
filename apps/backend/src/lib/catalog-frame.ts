/**
 * HU-07 — the owner adds a frame (or a case) by hand: `POST /admin/catalog/frames`
 * (docs/PRICE-MATRIX.md). PURE: validation and the Medusa product payload.
 *
 * The product is created the way the scraper creates one
 * (apps/scraper/scraper/medusa_push.py, and src/scripts/seed-qa-catalog.ts
 * which mirrors it): a «Color» option, one variant per colour, no inventory
 * tracking, the brand / measures in `metadata` — so the storefront, the till,
 * the assortment and every price view read it like any other model. Two
 * things set it apart:
 *
 *   metadata.source = "manual"   the catalogue sync never drafts nor
 *                                overwrites it (the scraper skips it)
 *   metadata.first_seen_at       the moment it was added, as the scraper
 *                                stamps a model it creates
 *
 * Its Medusa base price is `sellingPrice(cost)` (lib/pricing.ts), the same
 * conversion every Capri model went through.
 */
import { sellingPrice } from "./pricing";

export interface CatalogFrameColor {
  name: string;
  image: string | null;
}

export interface CatalogFrameInput {
  kind: "frame" | "case";
  brand: string;
  brand_slug: string;
  sku: string;
  model: string;
  colors: CatalogFrameColor[];
  eye_size: number | null;
  bridge_size: number | null;
  temple_length: number | null;
  /** Cents; null = unknown (the base price then comes from the store prices). */
  cost_cents: number | null;
  /** Per store: price in CENTS (null = follow the rule) and discount % (null = none). */
  prices: Record<string, { price_cents: number | null; discount_pct: number | null }>;
}

/** "GR 829" / "CASE C-26" → "gr-829" / "case-c-26": the scraper's handle rule. */
export const handleOfSku = (sku: string): string =>
  sku
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** "Di Caprio" → "di-caprio" (accents dropped). */
export const brandSlugOf = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Measure limits in mm: wider than any frame Capri lists, narrow enough to catch a typo. */
export const MEASURES = {
  eye_size: [30, 75],
  bridge_size: [8, 30],
  temple_length: [100, 170],
} as const;
export const MAX_COLORS = 30;

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const httpsUrl = (v: unknown): boolean => {
  if (typeof v !== "string" || v.length > 1000) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

function amountCents(v: unknown): number | null | "bad" {
  if (blank(v)) return null;
  const n = Number(v);
  if (typeof v === "boolean" || !Number.isFinite(n) || n < 0 || n > 100_000) return "bad";
  return Math.round(n * 100);
}

/**
 * Validates the body as the panel sends it. Reasons: `bad_kind`, `bad_brand`,
 * `bad_sku`, `bad_colors`, `bad_measure`, `bad_value`, `discount_range`.
 * Store ids in `prices` are NOT checked here (the route knows the stores).
 */
export function cleanCatalogFrame(body: Record<string, unknown>): { frame: CatalogFrameInput } | { reason: string } {
  const kind = blank(body["kind"]) ? "frame" : body["kind"];
  if (kind !== "frame" && kind !== "case") return { reason: "bad_kind" };

  const brand = text(body["brand"], 80) ?? (kind === "case" && blank(body["brand"]) ? "Cases (estuches)" : null);
  if (!brand) return { reason: "bad_brand" };
  const slugIn = blank(body["brand_slug"]) ? (kind === "case" && blank(body["brand"]) ? "case" : brandSlugOf(brand)) : String(body["brand_slug"]).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slugIn)) return { reason: "bad_brand" };

  const sku = text(body["sku"], 40);
  if (!sku || !handleOfSku(sku)) return { reason: "bad_sku" };
  const model = text(body["model"], 120) ?? (blank(body["model"]) ? sku : null);
  if (!model) return { reason: "bad_sku" };

  const rawColors = body["colors"] ?? [];
  if (!Array.isArray(rawColors) || rawColors.length > MAX_COLORS) return { reason: "bad_colors" };
  const colors: CatalogFrameColor[] = [];
  const seen = new Set<string>();
  for (const c of rawColors) {
    const obj = typeof c === "string" ? { name: c } : (c as Record<string, unknown> | null);
    if (!obj || typeof obj !== "object") return { reason: "bad_colors" };
    const name = text(obj["name"], 60);
    if (!name) return { reason: "bad_colors" };
    const k = handleOfSku(name) || name.toLowerCase();
    if (seen.has(k)) return { reason: "bad_colors" };
    seen.add(k);
    if (!blank(obj["image"]) && !httpsUrl(obj["image"])) return { reason: "bad_colors" };
    colors.push({ name, image: blank(obj["image"]) ? null : String(obj["image"]) });
  }
  // A model with no colour still needs one variant to be sellable, like the scraper's "Default".
  if (!colors.length) colors.push({ name: "Default", image: null });

  const measures: Record<keyof typeof MEASURES, number | null> = { eye_size: null, bridge_size: null, temple_length: null };
  for (const [field, [min, max]] of Object.entries(MEASURES) as Array<[keyof typeof MEASURES, readonly [number, number]]>) {
    const v = body[field];
    if (blank(v)) continue;
    const n = Number(v);
    if (typeof v === "boolean" || !Number.isFinite(n) || n < min || n > max) return { reason: "bad_measure" };
    measures[field] = Math.round(n * 10) / 10;
  }

  const cost = amountCents(body["cost"]);
  if (cost === "bad") return { reason: "bad_value" };

  const rawPrices = body["prices"] ?? {};
  if (!rawPrices || typeof rawPrices !== "object" || Array.isArray(rawPrices)) return { reason: "bad_value" };
  const prices: CatalogFrameInput["prices"] = {};
  for (const [storeId, cellRaw] of Object.entries(rawPrices as Record<string, unknown>)) {
    if (!storeId.trim() || !cellRaw || typeof cellRaw !== "object" || Array.isArray(cellRaw)) return { reason: "bad_value" };
    const cell = cellRaw as Record<string, unknown>;
    const price = amountCents(cell["price"]);
    if (price === "bad") return { reason: "bad_value" };
    let pct: number | null = null;
    if (!blank(cell["discount"])) {
      const n = Number(cell["discount"]);
      if (typeof cell["discount"] === "boolean" || !Number.isFinite(n)) return { reason: "bad_value" };
      if (n < 0 || n > 90) return { reason: "discount_range" };
      pct = Math.round(n * 100) / 100 || null;
    }
    prices[storeId.trim()] = { price_cents: price, discount_pct: pct };
  }
  // Without a cost the base price has to come from somewhere: at least one store price.
  if (cost === null && !Object.values(prices).some((p) => p.price_cents !== null)) return { reason: "bad_value" };

  return { frame: { kind, brand, brand_slug: slugIn, sku, model, colors, ...measures, cost_cents: cost, prices } };
}

/**
 * The model's Medusa base price, in dollars: the conversion of its cost
 * (`sellingPrice`, whole dollars, frame or case tier), else the highest store
 * price the owner typed. Pure.
 */
export function catalogBasePrice(frame: Pick<CatalogFrameInput, "kind" | "cost_cents" | "prices">): number {
  if (frame.cost_cents !== null) return sellingPrice(frame.cost_cents / 100, frame.kind);
  const typed = Object.values(frame.prices)
    .map((p) => p.price_cents)
    .filter((c): c is number => c !== null);
  return typed.length ? Math.max(...typed) / 100 : 0;
}

/**
 * The `createProductsWorkflow` input for one manual model. `channelIds` = the
 * default sales channel AND every store's, so it sells on the web and in every
 * till (a till's cart lives in its store's channel). Pure.
 */
export function buildCatalogFrameProduct(frame: CatalogFrameInput, opts: { channelIds: string[]; now: Date; actorId: string | null }): Record<string, unknown> {
  const amount = catalogBasePrice(frame);
  const handle = handleOfSku(frame.sku);
  const firstImage = frame.colors.find((c) => c.image)?.image ?? null;
  return {
    title: frame.model,
    handle,
    status: "published",
    options: [{ title: "Color", values: frame.colors.map((c) => c.name) }],
    variants: frame.colors.map((c, idx) => ({
      title: c.name,
      // The first colour carries the model's SKU — the key costs and prices join on.
      sku: idx === 0 ? frame.sku : `${frame.sku}-${handleOfSku(c.name) || idx + 1}`,
      options: { Color: c.name },
      manage_inventory: false,
      prices: [{ currency_code: "usd", amount }],
      metadata: { color: c.name, image: c.image },
    })),
    images: frame.colors.filter((c) => c.image).map((c) => ({ url: c.image as string })),
    thumbnail: firstImage,
    sales_channels: [...new Set(opts.channelIds.filter(Boolean))].map((id) => ({ id })),
    metadata: {
      brand: frame.brand,
      brand_slug: frame.brand_slug,
      collection_slug: frame.brand_slug,
      kind: frame.kind,
      eye_size: frame.eye_size,
      bridge_size: frame.bridge_size,
      temple_length: frame.temple_length,
      source: "manual",
      created_by: opts.actorId,
      first_seen_at: opts.now.toISOString(),
    },
  };
}
