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

/** Base lens price for a (design, material) cell of the matrix. */
export const LensBasePrice = model.define("lens_base_price", {
  id: model.id().primaryKey(),
  design_code: model.text(),
  material_code: model.text(),
  price_cents: model.number().default(0),
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
