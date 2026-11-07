import { model } from "@medusajs/framework/utils";

export const LensOption = model.define("lens_option", {
  id: model.id().primaryKey(),
  usage_type: model.enum([
    "single_vision_distance",
    "single_vision_reading",
    "progressive",
    "non_prescription",
  ]),
  index: model.float(),
  label: model.text(),
  description: model.text().nullable(),
  price_modifier_cents: model.number().default(0),
  is_active: model.boolean().default(true),
});

export const CoatingOption = model.define("coating_option", {
  id: model.id().primaryKey(),
  type: model.enum([
    "anti_reflective",
    "blue_light",
    "photochromic",
    "polarized",
    "tint",
  ]),
  label: model.text(),
  description: model.text().nullable(),
  price_modifier_cents: model.number().default(0),
  compatible_usage_types: model.array().default([]),
  is_active: model.boolean().default(true),
});

// ── 2026 price list ("matriz") ────────────────────────────────────────────────
// Óptica El Rancho's real price list, editable from the admin. All amounts are in
// USD cents (integers) to match Medusa product prices and the existing lens module,
// so lens add-ons and the frame price sum in the same unit server-side.

/** Lens design / usage (rows of the matrix). `category` drives photochromic pricing. */
export const LensDesign = model.define("lens_design", {
  id: model.id().primaryKey(),
  code: model.text().unique(), // "sv" | "bifocal" | "prog-mid" | "prog-high"
  category: model.text(),      // "sv" | "bifocal" | "prog"
  label_es: model.text(),
  label_en: model.text(),
  requires_rx: model.boolean().default(true),
  requires_add: model.boolean().default(false),
  sort: model.number().default(0),
  is_active: model.boolean().default(true),
  /** Named progressive designs: the owner's tier label ("Básico" … "Elite"). */
  tier: model.text().nullable(),
  /** Short "who is it for" text shown next to the tier. */
  use_es: model.text().nullable(),
  use_en: model.text().nullable(),
});

/** Lens material (columns of the matrix). `max_abs` = max recommended Rx magnitude. */
export const LensMaterial = model.define("lens_material", {
  id: model.id().primaryKey(),
  code: model.text().unique(), // "cr39" | "poly" | "1.56" | "1.61" | "1.67" | "1.74"
  label_es: model.text(),
  label_en: model.text(),
  desc_es: model.text().nullable(),
  desc_en: model.text().nullable(),
  max_abs: model.float().default(99),
  sort: model.number().default(0),
  is_active: model.boolean().default(true),
});

/**
 * Base lens price for a (design, material, finish) cell of the matrix.
 * `finish` "stock" | "digital" (lib/lens-finish.ts): single vision and bifocals
 * may hold both; progressives only a digital cell. `cost_cents` is the lab's
 * price to the shop for that cell (null = unknown → cost rules apply); it is
 * read with cost privileges only and never leaves on the public matrix.
 */
export const LensBasePrice = model.define("lens_base_price", {
  id: model.id().primaryKey(),
  design_code: model.text(),
  material_code: model.text(),
  finish: model.text().default("stock"),
  price_cents: model.number().default(0),
  cost_cents: model.number().nullable(),
});

/** Photochromic / Transitions add-on, priced per design category (null = N/A). */
export const LensPhotoOption = model.define("lens_photo_option", {
  id: model.id().primaryKey(),
  code: model.text().unique(),
  label_es: model.text(),
  label_en: model.text(),
  colors: model.array().default([]),
  price_sv_cents: model.number().nullable(),
  price_bifocal_cents: model.number().nullable(),
  price_prog_cents: model.number().nullable(),
  /**
   * Legacy single lab cost (before costs per category). Still read as the
   * fallback of a category with no cost of its own; new writes go per category.
   */
  cost_cents: model.number().nullable(),
  /** What the lab charges per design category (a bifocal or progressive blank costs more); null = unknown. Never public. */
  cost_sv_cents: model.number().nullable(),
  cost_bifocal_cents: model.number().nullable(),
  cost_prog_cents: model.number().nullable(),
  sort: model.number().default(0),
  is_active: model.boolean().default(true),
});

/** Anti-reflective add-on. `ar_group` = "sv" or "bifprog" (which designs it applies to). */
export const LensArOption = model.define("lens_ar_option", {
  id: model.id().primaryKey(),
  code: model.text().unique(),
  label_es: model.text(),
  label_en: model.text(),
  ar_group: model.text(), // "sv" | "bifprog" | "all"
  price_cents: model.number().default(0),
  /** What the lab charges for it; null = unknown. Never public. */
  cost_cents: model.number().nullable(),
  sort: model.number().default(0),
  is_active: model.boolean().default(true),
});

/**
 * Per (design × material) price of a treatment add-on. Needed because AR and
 * photochromic prices vary by material (and by design gama), which the flat
 * lens_ar_option / per-category lens_photo_option columns cannot express.
 * `treatment_code` ∈ { "ar-green" | "ar-blue" | "photo" }. USD cents.
 */
export const LensTreatmentPrice = model.define("lens_treatment_price", {
  id: model.id().primaryKey(),
  design_code: model.text(),
  material_code: model.text(),
  treatment_code: model.text(),
  price_cents: model.number().default(0),
});

/**
 * A store's variation of the master lens list (pricing panel, "Lentes" per
 * store). `item_kind` "adjust" = one percentage over the whole master
 * (`item_key` "all", `value` = percent); "base" = exact cents of a
 * (design, material) cell (`item_key` "<design>:<material>"); "photo" = exact
 * cents of a photochromic option in a category (`item_key` "<code>:<sv|bifocal|prog>");
 * "ar" = exact cents of an AR option (`item_key` "<code>"). A cell override
 * wins over the percentage. Read by lens-quote.ts when quoting for a store.
 */
export const LensStorePrice = model.define("lens_store_price", {
  id: model.id().primaryKey(),
  establishment_id: model.text(),
  item_kind: model.text(),
  item_key: model.text(),
  value: model.float(),
  created_by: model.text().nullable(),
});
