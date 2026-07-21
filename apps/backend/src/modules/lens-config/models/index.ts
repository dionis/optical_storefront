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
