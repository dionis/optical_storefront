import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { loadProductMetadata } from "./frame-specs";

/**
 * Who a till sale was for and what was sold on it, read from the SOURCE
 * tables: `customer` for the buyer, the Medusa order's lines
 * (`order_item` ⋈ `order_line_item`) plus the product's metadata for the
 * frame, and the line's own metadata for the lenses and the prescription.
 *
 * Why this exists: the panel's sales list used to fill these columns with a
 * SECOND request to GET /admin/sales-analytics/sales, joined by `sale_id`.
 * That list reads `sale_fact`, a projection — a sale with no row there (the
 * projection failed, or the sale is older than the table and was never
 * backfilled) showed up with customer, brand and model empty. Here there is
 * nothing to project: either the sale has an order with lines, or it does not.
 *
 * The field names and the shape are the ones the analytics list already
 * returns (lib/sales-analytics.ts, `saleListRowOf`), on purpose: the panel
 * must not have to know which side a value came from.
 *
 * Cost per page of the list, whatever the number of sales: one query for the
 * customers, one for the lines, one for those lines' products and up to four
 * for the lens labels. Never one query per sale — this list is open all day.
 * Everything is best-effort: a sale with no order or no customer gets nulls,
 * never an error.
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

export interface LensCodes {
  design: string | null;
  material: string | null;
  photo: string | null;
  ar: string | null;
}

/** The descriptive half of a sale row, named as lib/sales-analytics.ts names it. */
export interface SaleDetail {
  /** The customer's name, or their email when the name is empty. */
  customer_name: string | null;
  customer_phone: string | null;
  /** The frame sold: brand, model (the customer's description for an own frame), colour (variant), SKU. */
  frame_brand: string | null;
  frame_model: string | null;
  frame_color: string | null;
  frame_sku: string | null;
  /** Lenses mounted on a frame the customer brought. */
  own_frame: boolean;
  /** Prescription lenses: a line with a prescription, or a lens design other than frame-only. */
  has_rx: boolean;
  lens: LensCodes | null;
  /** The lenses as short labels per language ("Monofocal · CR-39 · AR"), codes where a label is missing. */
  lens_summary: { es: string; en: string } | null;
  /** The sold titles joined, as the analytics list's `items`. */
  items: string;
}

/** A sale with no order, no lines and no customer: nulls, not an error. */
export const EMPTY_SALE_DETAIL: SaleDetail = {
  customer_name: null,
  customer_phone: null,
  frame_brand: null,
  frame_model: null,
  frame_color: null,
  frame_sku: null,
  own_frame: false,
  has_rx: false,
  lens: null,
  lens_summary: null,
  items: "",
};

/** What `listSales` hands in: enough to find the customer and the order. */
export interface SaleDetailInput {
  id: string;
  order_id: string | null;
  customer_id: string | null;
}

/** One order line as this module reads it (`order_item` ⋈ `order_line_item`). */
export interface SaleLineRow {
  order_id: string;
  /** `order_line_item.id` — the id the analytics projection stores as `line_item_id`. */
  id: string;
  /** Version of the order the line belongs to; an edited order keeps the older ones. */
  version: number | string | null;
  product_id: string | null;
  variant_sku: string | null;
  product_title: string | null;
  title: string | null;
  variant_title: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CustomerLike {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

type Bilingual = { label_es?: string | null; label_en?: string | null };
export type LensLabelMaps = { designs: Map<string, Bilingual>; materials: Map<string, Bilingual>; photos: Map<string, Bilingual>; ars: Map<string, Bilingual> };

/** How one line reads: what it is, and the lenses on it. */
export interface LineFact {
  line_item_id: string;
  /** frame | case | own_frame — the categories the projection uses. */
  category: "frame" | "case" | "own_frame";
  brand: string | null;
  title: string;
  sku: string | null;
  variant_title: string | null;
  metadata: Record<string, unknown> | null;
  lens: LensCodes;
  has_prescription: boolean;
}

/**
 * Reads one order line the way lib/sale-facts.ts `factFromLine` reads it for
 * the projection: `metadata.kind === "own-frame"` is what marks a frame the
 * customer brought, a `lens_config.design_code` other than `frame-only` is
 * what marks lenses, the display brand comes from the product's metadata (not
 * from a Medusa collection, which is null on every order of this store) and
 * falls back to its slug, and a product whose slug is `case` is a case rather
 * than a frame.
 *
 * It is a copy and not a call because `factFromLine` also computes the
 * projection's money (list, discount, tax, totals) and needs its whole
 * LineContext — a store, a till, a seller, a time zone — none of which a list
 * row has any use for. The two readings must agree: change them together.
 * Pure.
 */
export function lineFactOf(line: SaleLineRow, productMeta: Record<string, unknown> | undefined): LineFact {
  const md = line.metadata ?? {};
  const sel = (md.lens_config ?? {}) as Record<string, string | null | undefined>;
  const meta = productMeta ?? {};
  const slug = String(meta.brand_slug ?? meta.collection_slug ?? "");
  const own = md.kind === "own-frame";
  const withLenses = Boolean(sel.design_code) && sel.design_code !== "frame-only";
  const str = (v: unknown) => {
    const s = v == null ? "" : String(v).trim();
    return s.length ? s : null;
  };
  return {
    line_item_id: String(line.id),
    category: own ? "own_frame" : slug === "case" ? "case" : "frame",
    brand: own ? null : str(meta.brand) ?? (slug || null),
    title: String(own ? "own_frame" : line.product_title ?? line.title ?? ""),
    sku: own ? null : str(line.variant_sku),
    variant_title: str(line.variant_title),
    metadata: line.metadata ?? null,
    lens: {
      design: withLenses ? sel.design_code ?? null : null,
      material: withLenses ? sel.material_code ?? null : null,
      photo: withLenses ? sel.photo_code ?? null : null,
      ar: withLenses ? sel.ar_code ?? null : null,
    },
    has_prescription: Boolean(md.prescription_id),
  };
}

/**
 * "Monofocal · CR-39 · Fotocromático · AR" per language, with the code where a
 * label is missing. The same text the analytics list builds (its own
 * `lensSummaryOf`); copied so the point-of-sale list does not depend on a
 * module that is being worked on elsewhere. Pure.
 */
export function lensSummaryOf(lens: LensCodes, labels?: LensLabelMaps): { es: string; en: string } | null {
  if (!lens.design && !lens.material && !lens.photo && !lens.ar) return null;
  const pick = (map: Map<string, Bilingual> | undefined, code: string | null, lang: "es" | "en") => {
    if (!code) return null;
    const l = map?.get(code);
    const v = lang === "es" ? l?.label_es ?? l?.label_en : l?.label_en ?? l?.label_es;
    return v && String(v).trim() ? String(v).trim() : code;
  };
  const build = (lang: "es" | "en") =>
    [pick(labels?.designs, lens.design, lang), pick(labels?.materials, lens.material, lang), pick(labels?.photos, lens.photo, lang), pick(labels?.ars, lens.ar, lang)]
      .filter(Boolean)
      .join(" · ");
  return { es: build("es"), en: build("en") };
}

/** The customer's name, or their email when there is no name. Pure. */
export function customerNameOf(c: CustomerLike | null | undefined): string | null {
  if (!c) return null;
  return [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email || null;
}

/**
 * The detail of one sale from its lines and its customer. Mirrors the
 * aggregate the analytics list runs over `sale_fact`: the sale's frame (one
 * per till sale; the first frame line of a web order), whether a frame the
 * customer brought is on it, whether it carries a prescription, and its lens
 * codes. Pure, so the shape is testable without a database.
 */
export function saleDetailOf(lines: SaleLineRow[], productMeta: Map<string, Record<string, unknown>>, customer?: CustomerLike | null, labels?: LensLabelMaps): SaleDetail {
  const facts = lines.map((l) => lineFactOf(l, productMeta.get(String(l.product_id ?? ""))));
  const first = <T,>(list: Array<T | null | undefined>): T | null => list.find((v) => v !== null && v !== undefined) ?? null;
  const frames = facts.filter((f) => f.category === "frame");
  // The frame's line also when the customer brought it: that is where its
  // description and the variant colour live.
  const frameLine = facts.find((f) => f.category === "frame" || f.category === "own_frame") ?? null;
  const own = facts.some((f) => f.category === "own_frame");
  const ownMd = (frameLine?.metadata?.own_frame ?? null) as { description?: string | null } | null;
  const brand = first(frames.map((f) => f.brand));
  const model = first(frames.map((f) => (f.title.trim() ? f.title : null)));
  const lens: LensCodes = {
    design: first(facts.map((f) => f.lens.design)),
    material: first(facts.map((f) => f.lens.material)),
    photo: first(facts.map((f) => f.lens.photo)),
    ar: first(facts.map((f) => f.lens.ar)),
  };
  const hasLens = Boolean(lens.design || lens.material || lens.photo || lens.ar);
  return {
    customer_name: customerNameOf(customer),
    customer_phone: customer?.phone ? String(customer.phone) : null,
    frame_brand: brand,
    frame_model: model ?? (own ? (ownMd?.description && String(ownMd.description).trim()) || null : null),
    // An own frame has no variant, so it has no colour either.
    frame_color: model ? first(frames.map((f) => f.variant_title)) : null,
    frame_sku: first(frames.map((f) => f.sku)),
    own_frame: own,
    has_rx: facts.some((f) => f.has_prescription || f.lens.design !== null),
    lens: hasLens ? lens : null,
    lens_summary: lensSummaryOf(lens, labels),
    items: facts.map((f) => f.title).filter(Boolean).join(" · "),
  };
}

/**
 * The lines of each order, keeping only the current version. An edited order
 * keeps its superseded `order_item` rows, and counting a replaced line twice
 * would put the wrong frame on the row. Pure.
 */
export function currentLinesByOrder(rows: SaleLineRow[]): Map<string, SaleLineRow[]> {
  const byOrder = new Map<string, SaleLineRow[]>();
  for (const r of rows) {
    const key = String(r.order_id);
    const list = byOrder.get(key);
    if (list) list.push(r);
    else byOrder.set(key, [r]);
  }
  for (const [key, list] of byOrder) {
    const top = Math.max(...list.map((r) => Number(r.version ?? 0) || 0));
    byOrder.set(
      key,
      list.filter((r) => (Number(r.version ?? 0) || 0) === top)
    );
  }
  return byOrder;
}

/** Bilingual labels of the lens codes in use — the same catalog tables the receipts read. Never throws. */
async function loadLensLabels(pg: Knex, codes: { designs: string[]; materials: string[]; photos: string[]; ars: string[] }): Promise<LensLabelMaps> {
  const fetch = async (table: string, list: string[]) => {
    const uniq = [...new Set(list.filter(Boolean))];
    if (!uniq.length) return new Map<string, Bilingual>();
    try {
      const rows = (await pg(table).whereIn("code", uniq).select("code", "label_es", "label_en")) as Array<{ code: string } & Bilingual>;
      return new Map(rows.map((r) => [String(r.code), r]));
    } catch {
      // Unknown schema or a catalog table that is not there: the codes stand in for the labels.
      return new Map<string, Bilingual>();
    }
  };
  const [designs, materials, photos, ars] = await Promise.all([
    fetch("lens_design", codes.designs),
    fetch("lens_material", codes.materials),
    fetch("lens_photo_option", codes.photos),
    fetch("lens_ar_option", codes.ars),
  ]);
  return { designs, materials, photos, ars };
}

/**
 * The detail of a page of sales, by sale id. Batched: one query for every
 * customer of the page, one for every line of every order of the page, one for
 * those lines' products, up to four for the lens labels. A sale whose id is
 * absent from the map simply has no detail to add.
 */
export async function loadSaleDetails(container: MedusaContainer, sales: SaleDetailInput[]): Promise<Map<string, SaleDetail>> {
  const out = new Map<string, SaleDetail>();
  if (!sales.length) return out;
  const pg = pgOf(container);
  const uniq = (list: Array<string | null | undefined>) => [...new Set(list.filter((v): v is string => Boolean(v)))];
  const customerIds = uniq(sales.map((s) => s.customer_id));
  const orderIds = uniq(sales.map((s) => s.order_id));

  type CustomerRow = { id: string } & CustomerLike;
  const none = <T,>(): Promise<T[]> => Promise.resolve([]);
  const [customerRows, lineRows] = await Promise.all([
    customerIds.length
      ? (pg("customer").whereIn("id", customerIds).select("id", "first_name", "last_name", "email", "phone") as Promise<CustomerRow[]>).catch(() => none<CustomerRow>())
      : none<CustomerRow>(),
    orderIds.length
      ? (pg("order_item as oi")
          .innerJoin("order_line_item as li", "li.id", "oi.item_id")
          .whereIn("oi.order_id", orderIds)
          // A removed line is soft-deleted on `order_item`; `order_line_item` has no such column.
          .whereNull("oi.deleted_at")
          .select(
            "oi.order_id as order_id",
            "oi.version as version",
            "li.id as id",
            "li.product_id as product_id",
            "li.variant_sku as variant_sku",
            "li.product_title as product_title",
            "li.title as title",
            "li.variant_title as variant_title",
            "li.metadata as metadata"
          ) as Promise<SaleLineRow[]>).catch(() => none<SaleLineRow>())
      : none<SaleLineRow>(),
  ]);

  const byOrder = currentLinesByOrder(lineRows);
  const productMeta = await loadProductMetadata(pg, [...byOrder.values()].flat().map((l) => String(l.product_id ?? "")));
  // The lens codes of the whole page in one pass, so the labels are four queries and not four per sale.
  const codes = { designs: [] as string[], materials: [] as string[], photos: [] as string[], ars: [] as string[] };
  for (const line of lineRows) {
    const sel = ((line.metadata ?? {}).lens_config ?? {}) as Record<string, string | null | undefined>;
    if (!sel.design_code || sel.design_code === "frame-only") continue;
    codes.designs.push(sel.design_code);
    if (sel.material_code) codes.materials.push(sel.material_code);
    if (sel.photo_code) codes.photos.push(sel.photo_code);
    if (sel.ar_code) codes.ars.push(sel.ar_code);
  }
  const labels = await loadLensLabels(pg, codes);

  const customers = new Map(customerRows.map((c) => [String(c.id), c]));
  for (const s of sales) {
    const lines = s.order_id ? byOrder.get(String(s.order_id)) ?? [] : [];
    const customer = s.customer_id ? customers.get(String(s.customer_id)) ?? null : null;
    out.set(s.id, saleDetailOf(lines, productMeta, customer, labels));
  }
  return out;
}
