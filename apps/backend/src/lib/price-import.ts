import { normalizeModel } from "./pricing";

/**
 * Plan for importing the owner's price list — the JSON the admin's Prices tab
 * exports (storefront src/admin/priceStore.js). Pure: it decides what each key
 * becomes and what cannot be matched, before anything is written.
 *
 * Those prices only ever lived in the owner's browser, so the web never charged
 * them. The owner decided they become the base price everywhere, the web
 * included (docs "Gestión de Tiendas RUBI LENS"). Where each group lands:
 *
 *  - frames / cases  {<model>: price}  → a global price rule per product (the
 *    base for the web and every store; price-sync then keeps it instead of the
 *    wholesale-derived price). Keys are model names, matched like price-sync
 *    matches the wholesale sheet: normalizeModel(title).
 *  - lens  {"b:<design>:<material>": price} → lens_base_price
 *          {"p:<photo>:<sv|bifocal|prog>": price} → lens_photo_option
 *          {"a:<ar>": price} → lens_ar_option — except AR Green/Blue, which the
 *          server prices per design × material (lens_treatment_price): one
 *          number cannot fill that matrix, so they are reported for review.
 *  - materials / treatments / usage: keys of the pre-2026 lens model that the
 *    server no longer prices; reported, not imported.
 *  - shipping: not a price rule (the server charges SHIPPING_FEDEX_RATE);
 *    reported so nobody assumes it moved.
 */

export interface OwnerPriceList {
  frames?: Record<string, unknown>;
  cases?: Record<string, unknown>;
  lens?: Record<string, unknown>;
  materials?: Record<string, unknown>;
  treatments?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  shipping?: unknown;
}

export interface CatalogProduct {
  id: string;
  title: string;
}

export interface LensKnown {
  /** "design:material" pairs present in lens_base_price. */
  base: Set<string>;
  /** lens_photo_option codes. */
  photo: Set<string>;
  /** lens_ar_option codes. */
  ar: Set<string>;
}

/** AR codes the server prices from the treatment matrix, not lens_ar_option. */
export const MATRIX_PRICED_AR = new Set(["ar-green", "ar-blue"]);
const PHOTO_CATEGORIES = new Set(["sv", "bifocal", "prog"]);

export interface ImportPlan {
  products: Array<{ scope: "frame" | "case"; product_id: string; title: string; key: string; price: number }>;
  lens: {
    base: Array<{ design_code: string; material_code: string; price_cents: number }>;
    photo: Array<{ code: string; category: "sv" | "bifocal" | "prog"; price_cents: number }>;
    ar: Array<{ code: string; price_cents: number }>;
  };
  skipped: Array<{ group: string; key: string; reason: string }>;
}

function validPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
}

export function planOwnerPriceImport(list: OwnerPriceList, catalog: CatalogProduct[], known: LensKnown): ImportPlan {
  const plan: ImportPlan = { products: [], lens: { base: [], photo: [], ar: [] }, skipped: [] };

  const byModel = new Map<string, CatalogProduct[]>();
  for (const p of catalog) {
    const k = normalizeModel(p.title);
    if (!k) continue;
    byModel.set(k, [...(byModel.get(k) ?? []), p]);
  }

  for (const [group, scope] of [["frames", "frame"], ["cases", "case"]] as const) {
    for (const [key, raw] of Object.entries(list[group] ?? {})) {
      const price = validPrice(raw);
      if (price === null) { plan.skipped.push({ group, key, reason: "bad_price" }); continue; }
      const hits = byModel.get(normalizeModel(key)) ?? [];
      if (hits.length === 0) { plan.skipped.push({ group, key, reason: "no_product" }); continue; }
      if (hits.length > 1) { plan.skipped.push({ group, key, reason: "ambiguous_product" }); continue; }
      plan.products.push({ scope, product_id: hits[0].id, title: hits[0].title, key, price });
    }
  }

  for (const [key, raw] of Object.entries(list.lens ?? {})) {
    const price = validPrice(raw);
    if (price === null) { plan.skipped.push({ group: "lens", key, reason: "bad_price" }); continue; }
    const cents = Math.round(price * 100);
    const [kind, a, b] = key.split(":");
    if (kind === "b" && a && b) {
      if (known.base.has(`${a}:${b}`)) plan.lens.base.push({ design_code: a, material_code: b, price_cents: cents });
      else plan.skipped.push({ group: "lens", key, reason: "unknown_lens" });
    } else if (kind === "p" && a && b) {
      if (known.photo.has(a) && PHOTO_CATEGORIES.has(b)) {
        plan.lens.photo.push({ code: a, category: b as "sv" | "bifocal" | "prog", price_cents: cents });
      } else plan.skipped.push({ group: "lens", key, reason: "unknown_lens" });
    } else if (kind === "a" && a) {
      if (MATRIX_PRICED_AR.has(a)) plan.skipped.push({ group: "lens", key, reason: "matrix_priced" });
      else if (known.ar.has(a)) plan.lens.ar.push({ code: a, price_cents: cents });
      else plan.skipped.push({ group: "lens", key, reason: "unknown_lens" });
    } else {
      plan.skipped.push({ group: "lens", key, reason: "unknown_lens" });
    }
  }

  for (const group of ["materials", "treatments", "usage"] as const) {
    for (const key of Object.keys(list[group] ?? {})) plan.skipped.push({ group, key, reason: "legacy_lens_model" });
  }
  if (list.shipping && typeof list.shipping === "object" && Object.keys(list.shipping).length) {
    plan.skipped.push({ group: "shipping", key: "shipping", reason: "not_a_price_rule" });
  }
  return plan;
}
