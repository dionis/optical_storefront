/**
 * Physical characteristics of a frame that was bought, read from the product
 * metadata the scraper writes (apps/scraper/scraper/medusa_push.py).
 *
 * Values stay RAW here — `cat-eye`, `full-frame`, `injection-2` — because the two
 * consumers localize differently: the order emails render server-side and pick
 * the message locale, while the tracking page localizes in the browser from the
 * shopper's active language. Handing prose to the storefront is what put Spanish
 * strings inside English pages before; the same rule applies to attributes.
 *
 * Everything is best-effort: a missing table or an unscraped product yields
 * `null` and the caller simply omits the block.
 */
import type { Knex } from "@mikro-orm/knex";

export interface RawFrameSpecs {
  /**
   * Display brand ("Four You", "Di Caprio"). Lives in product metadata, NOT in a
   * Medusa collection — `order_line_item.product_collection` is null on every
   * order in this store, which is why the brand row never rendered anywhere that
   * relied on it.
   */
  brand: string | null;
  /** Variant SKU / UPC of the exact color ordered. */
  sku: string | null;
  eye_size: number | null;
  bridge_size: number | null;
  temple_length: number | null;
  /** A measurement (horizontal lens width) — falls back to eye_size. */
  lens_width: number | null;
  /** B measurement (vertical lens height). */
  lens_height: number | null;
  shape: string | null;
  /** Rim construction: full-frame, semi-rimless, 3-piece-rimless… */
  style: string | null;
  material: string | null;
  gender: string | null;
  age_group: string | null;
  features: string[];
}

const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || Number.isNaN(n) ? null : n;
};

const strOrNull = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s.length ? s : null;
};

/** Frame metadata for every product in an order, in one query. Never throws. */
export async function loadProductMetadata(
  pg: Knex,
  productIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(productIds.filter(Boolean).map(String))];
  if (!ids.length) return map;
  try {
    const rows = await pg("product").whereIn("id", ids).select("id", "metadata");
    for (const row of rows as Array<Record<string, unknown>>) {
      map.set(String(row["id"]), (row["metadata"] as Record<string, unknown>) ?? {});
    }
  } catch {
    // Unknown schema / missing table — callers just skip the technical sheet.
  }
  return map;
}

/**
 * Builds the technical sheet for one order line. `item` supplies the ordered
 * variant's SKU (a snapshot on the line item), `metadata` the product's
 * scraped attributes. Returns null when there is nothing worth showing — a
 * case, or a product that predates the attribute scrape.
 */
export function rawFrameSpecs(
  metadata: Record<string, unknown> | undefined,
  item: Record<string, unknown>
): RawFrameSpecs | null {
  const md = metadata ?? {};
  const eye = numOrNull(md["eye_size"]);
  const specs: RawFrameSpecs = {
    brand: strOrNull(md["brand"]) ?? strOrNull(md["brand_slug"]),
    sku: strOrNull(item["variant_sku"]),
    eye_size: eye,
    bridge_size: numOrNull(md["bridge_size"]),
    temple_length: numOrNull(md["temple_length"]),
    // `a` is frequently null in the catalog; the eye size is the same
    // measurement for practical purposes, so it stands in rather than blanking.
    lens_width: numOrNull(md["a"]) ?? eye,
    lens_height: numOrNull(md["b"]),
    shape: strOrNull(md["shape"]),
    style: strOrNull(md["style"]),
    material: strOrNull(md["material"]),
    gender: strOrNull(md["gender"]),
    age_group: strOrNull(md["age_group"]),
    features: Array.isArray(md["features"])
      ? (md["features"] as unknown[]).map(String).filter(Boolean)
      : [],
  };

  const empty =
    !specs.brand && !specs.sku && !specs.eye_size && !specs.shape && !specs.material &&
    !specs.style && !specs.gender && !specs.age_group && !specs.lens_height &&
    !specs.features.length;
  return empty ? null : specs;
}

/** Optical shorthand every optician reads at a glance: 52□18-140. */
export function frameSizeNotation(specs: RawFrameSpecs): string | null {
  const { eye_size: eye, bridge_size: bridge, temple_length: temple } = specs;
  if (eye != null && bridge != null && temple != null) return `${eye}□${bridge}-${temple}`;
  if (eye != null) return `${eye} mm`;
  return null;
}
