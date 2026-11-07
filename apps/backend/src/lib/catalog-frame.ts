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
  /** v2: the gallery (absolute URLs, an upload's `{url}`), main photo first. */
  images?: string[];
  /** v2: the PDP attributes, in the scraper's metadata keys (`FRAME_ATTRIBUTE_KEYS`). */
  attributes?: FrameAttributes;
  /** v2: the product description (Medusa `description`, as the scraper writes it). */
  description?: string | null;
}

/**
 * The PDP attributes of a model, under the SAME `product.metadata` keys the
 * scraper writes (apps/scraper/scraper/medusa_push.py `_build_medusa_payload`),
 * so the online store, the till card and the e-mails read a manual model like
 * a scraped one. Values are the catalogue's own words (raw slugs / labels as
 * the scraper stores them); `material` may be one value or a list (the QA
 * seed and the static catalogue use a list).
 */
export interface FrameAttributes {
  material?: string | string[] | null;
  shape?: string | null;
  style?: string | null;
  gender?: string | null;
  age_group?: string | null;
  features?: string[];
}
export const FRAME_ATTRIBUTE_KEYS = ["material", "shape", "style", "gender", "age_group", "features"] as const;
export const MAX_IMAGES = 20;
export const MAX_FEATURES = 20;
export const MAX_DESCRIPTION = 4000;

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
export const httpsUrl = (v: unknown): boolean => {
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
/** A short catalogue word ("Acetato", "cat-eye"), or null when blank; `undefined` = invalid. */
function attrText(v: unknown): string | null | undefined {
  if (blank(v)) return null;
  return typeof v === "string" && v.trim().length <= 60 ? v.trim() : undefined;
}

/**
 * The v2 extras of a model as the panel sends them: `images[]`, the PDP
 * attributes and `description`. Only the keys PRESENT are returned (an edit
 * changes nothing it was not sent). Reasons: `bad_images`, `bad_attribute`,
 * `bad_description`. Pure.
 */
export function cleanFrameExtras(body: Record<string, unknown>): { images?: string[]; attributes: FrameAttributes; description?: string | null } | { reason: string } {
  const out: { images?: string[]; attributes: FrameAttributes; description?: string | null } = { attributes: {} };
  if ("images" in body) {
    const raw = body["images"] ?? [];
    if (!Array.isArray(raw) || raw.length > MAX_IMAGES) return { reason: "bad_images" };
    const list: string[] = [];
    for (const u of raw) {
      if (!httpsUrl(u)) return { reason: "bad_images" };
      if (!list.includes(String(u))) list.push(String(u));
    }
    out.images = list;
  }
  for (const key of ["shape", "style", "gender", "age_group"] as const) {
    if (!(key in body)) continue;
    const v = attrText(body[key]);
    if (v === undefined) return { reason: "bad_attribute" };
    out.attributes[key] = v;
  }
  if ("material" in body) {
    const raw = body["material"];
    if (Array.isArray(raw)) {
      const list = raw.map(attrText);
      if (list.some((x) => x === undefined) || list.length > 10) return { reason: "bad_attribute" };
      out.attributes.material = list.filter((x): x is string => !!x);
    } else {
      const v = attrText(raw);
      if (v === undefined) return { reason: "bad_attribute" };
      out.attributes.material = v;
    }
  }
  if ("features" in body) {
    const raw = body["features"] ?? [];
    if (!Array.isArray(raw) || raw.length > MAX_FEATURES) return { reason: "bad_attribute" };
    const list = raw.map(attrText);
    if (list.some((x) => x === undefined)) return { reason: "bad_attribute" };
    out.attributes.features = [...new Set(list.filter((x): x is string => !!x))];
  }
  if ("description" in body) {
    const d = body["description"];
    if (blank(d)) out.description = null;
    else if (typeof d !== "string" || d.trim().length > MAX_DESCRIPTION) return { reason: "bad_description" };
    else out.description = d.trim();
  }
  return out;
}

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

  const extras = cleanFrameExtras(body);
  if ("reason" in extras) return extras;

  return {
    frame: {
      kind,
      brand,
      brand_slug: slugIn,
      sku,
      model,
      colors,
      ...measures,
      cost_cents: cost,
      prices,
      images: extras.images ?? [],
      attributes: extras.attributes,
      description: extras.description ?? null,
    },
  };
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
  // The gallery first (main photo = images[0]), then each colour's photo.
  const gallery = [...new Set([...(frame.images ?? []), ...frame.colors.map((c) => c.image).filter((u): u is string => !!u)])];
  const firstImage = gallery[0] ?? null;
  return {
    title: frame.model,
    handle,
    ...(frame.description ? { description: frame.description } : {}),
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
    images: gallery.map((url) => ({ url })),
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
      // The PDP attributes, in the scraper's keys (only those given).
      ...attributeMetadata(frame.attributes),
      source: "manual",
      created_by: opts.actorId,
      first_seen_at: opts.now.toISOString(),
    },
  };
}

/** The attributes as `product.metadata` keys: only those given; `null` clears one on an edit. Pure. */
export function attributeMetadata(attributes: FrameAttributes | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of FRAME_ATTRIBUTE_KEYS) {
    if (attributes && key in attributes) out[key] = attributes[key] ?? null;
  }
  return out;
}

// ── Editing a model (POST /admin/catalog/frames/:id) ─────────────────────────

/** One colour of an edit: an existing variant (`variant_id`: rename / new photo) or a new one. */
export interface FrameColorEdit {
  variant_id: string | null;
  name: string;
  /** undefined = keep the photo; null = remove it. */
  image?: string | null;
}

export interface CatalogFramePatch {
  title?: string;
  brand?: string;
  brand_slug?: string;
  status?: "published" | "draft";
  eye_size?: number | null;
  bridge_size?: number | null;
  temple_length?: number | null;
  images?: string[];
  attributes: FrameAttributes;
  description?: string | null;
  /** The WHOLE colour list wanted (absent = colours unchanged): an existing variant left out is removed. */
  colors?: FrameColorEdit[];
}

/**
 * Validates `POST /admin/catalog/frames/:id`. Only the keys present change.
 * `model` (or `title`) renames the model; `colors` is the full list wanted —
 * `{ variant_id, name, image? }` keeps / renames an existing colour, `{ name }`
 * adds one, and an existing colour left out is removed (the data layer refuses
 * with `variant_sold` when it was ever sold). Reasons: `bad_sku` (title),
 * `bad_brand`, `bad_status`, `bad_measure`, `bad_colors`, `bad_images`,
 * `bad_attribute`, `bad_description`, `nothing_to_change`. Pure.
 */
export function cleanCatalogFramePatch(body: Record<string, unknown>): { patch: CatalogFramePatch } | { reason: string } {
  const extras = cleanFrameExtras(body);
  if ("reason" in extras) return extras;
  const patch: CatalogFramePatch = { attributes: extras.attributes };
  if (extras.images !== undefined) patch.images = extras.images;
  if (extras.description !== undefined) patch.description = extras.description;
  const titleIn = "model" in body ? body["model"] : "title" in body ? body["title"] : undefined;
  if (titleIn !== undefined) {
    const t = text(titleIn, 120);
    if (!t) return { reason: "bad_sku" };
    patch.title = t;
  }
  if ("brand" in body) {
    const b = text(body["brand"], 80);
    if (!b) return { reason: "bad_brand" };
    patch.brand = b;
    patch.brand_slug = blank(body["brand_slug"]) ? brandSlugOf(b) : String(body["brand_slug"]).trim().toLowerCase();
  } else if ("brand_slug" in body) {
    patch.brand_slug = String(body["brand_slug"] ?? "").trim().toLowerCase();
  }
  if (patch.brand_slug !== undefined && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(patch.brand_slug)) return { reason: "bad_brand" };
  if ("status" in body) {
    if (body["status"] !== "published" && body["status"] !== "draft") return { reason: "bad_status" };
    patch.status = body["status"];
  }
  for (const [field, [min, max]] of Object.entries(MEASURES) as Array<[keyof typeof MEASURES, readonly [number, number]]>) {
    if (!(field in body)) continue;
    const v = body[field];
    if (blank(v)) {
      patch[field] = null;
      continue;
    }
    const n = Number(v);
    if (typeof v === "boolean" || !Number.isFinite(n) || n < min || n > max) return { reason: "bad_measure" };
    patch[field] = Math.round(n * 10) / 10;
  }
  if ("colors" in body) {
    const raw = body["colors"];
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_COLORS) return { reason: "bad_colors" };
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();
    const colors: FrameColorEdit[] = [];
    for (const c of raw) {
      const obj = typeof c === "string" ? { name: c } : (c as Record<string, unknown> | null);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { reason: "bad_colors" };
      const name = text(obj["name"], 60);
      if (!name) return { reason: "bad_colors" };
      const k = handleOfSku(name) || name.toLowerCase();
      if (seenNames.has(k)) return { reason: "bad_colors" };
      seenNames.add(k);
      const id = blank(obj["variant_id"]) ? null : String(obj["variant_id"]).trim();
      if (id) {
        if (seenIds.has(id)) return { reason: "bad_colors" };
        seenIds.add(id);
      }
      const edit: FrameColorEdit = { variant_id: id, name };
      if ("image" in obj) {
        if (blank(obj["image"])) edit.image = null;
        else if (!httpsUrl(obj["image"])) return { reason: "bad_colors" };
        else edit.image = String(obj["image"]);
      }
      colors.push(edit);
    }
    patch.colors = colors;
  }
  const changes = Object.keys(patch).filter((k) => k !== "attributes").length + Object.keys(patch.attributes).length;
  if (!changes) return { reason: "nothing_to_change" };
  return { patch };
}

/** What an existing variant looks like to the colour planner. */
export interface ExistingVariant {
  id: string;
  title: string;
  sku: string | null;
  metadata: Record<string, unknown> | null;
}

/** The variant writes an edit's colour list becomes. Pure. */
export interface ColorPlan {
  create: Array<{ name: string; image: string | null; sku: string }>;
  update: Array<{ id: string; name: string; image: string | null | undefined; renamed: boolean }>;
  remove: string[];
  /** Colour names the product's «Color» option must carry before the variants name them. */
  newOptionValues: string[];
  /** A `variant_id` that is not one of the product's. */
  unknown: string[];
}

/**
 * Plans the colour list of an edit against the product's variants: kept /
 * renamed, created (SKU `<model SKU>-<colour>`, never one already taken) and
 * removed (every existing variant the list leaves out). Pure.
 */
export function planColorEdit(existing: readonly ExistingVariant[], wanted: readonly FrameColorEdit[], modelSku: string, takenSkus: ReadonlySet<string> = new Set()): ColorPlan {
  const byId = new Map(existing.map((v) => [v.id, v]));
  const plan: ColorPlan = { create: [], update: [], remove: [], newOptionValues: [], unknown: [] };
  const optionValues = new Set(existing.map((v) => v.title.toLowerCase()));
  const kept = new Set<string>();
  const taken = new Set([...takenSkus].map((s) => s.toUpperCase()));
  for (const v of existing) if (v.sku) taken.add(v.sku.toUpperCase());
  for (const c of wanted) {
    if (c.variant_id) {
      const v = byId.get(c.variant_id);
      if (!v) {
        plan.unknown.push(c.variant_id);
        continue;
      }
      kept.add(v.id);
      const renamed = v.title !== c.name;
      if (renamed && !optionValues.has(c.name.toLowerCase())) {
        plan.newOptionValues.push(c.name);
        optionValues.add(c.name.toLowerCase());
      }
      if (renamed || c.image !== undefined) plan.update.push({ id: v.id, name: c.name, image: c.image, renamed });
      continue;
    }
    if (!optionValues.has(c.name.toLowerCase())) {
      plan.newOptionValues.push(c.name);
      optionValues.add(c.name.toLowerCase());
    }
    let sku = `${modelSku}-${handleOfSku(c.name) || "color"}`;
    for (let n = 2; taken.has(sku.toUpperCase()); n++) sku = `${modelSku}-${handleOfSku(c.name) || "color"}-${n}`;
    taken.add(sku.toUpperCase());
    plan.create.push({ name: c.name, image: c.image ?? null, sku });
  }
  for (const v of existing) if (!kept.has(v.id)) plan.remove.push(v.id);
  return plan;
}
