import { model } from "@medusajs/framework/utils";

/**
 * One sold line, flat and indexed, for the dashboards (technical document,
 * "Por qué una proyección sale_fact"): the global panel filters by store,
 * seller, product, brand, category and payment method at once and adds up
 * amounts — over orders + metadata that would mean scanning everything.
 *
 * Read-only projection written when a sale is recorded (till) or an order is
 * placed (web), and marked voided when the sale is voided. Amounts in cents.
 * No customer contact data, no prescription values.
 *
 * Order data: purged with the orders.
 */
export const SaleFact = model.define("sale_fact", {
  id: model.id({ prefix: "sf" }).primaryKey(),
  order_id: model.text(),
  line_item_id: model.text(),
  sale_id: model.text().nullable(),
  sale_number: model.text().nullable(),
  /** "pos" (a store's till) or "web" (online store). */
  channel: model.text(),
  establishment_id: model.text().nullable(),
  terminal_id: model.text().nullable(),
  seller_id: model.text().nullable(),
  seller_code: model.text().nullable(),
  customer_id: model.text().nullable(),
  product_id: model.text().nullable(),
  variant_id: model.text().nullable(),
  sku: model.text().nullable(),
  title: model.text().nullable(),
  brand: model.text().nullable(),
  /** frame | case | own_frame */
  category: model.text(),
  lens_design: model.text().nullable(),
  lens_material: model.text().nullable(),
  lens_photo: model.text().nullable(),
  lens_ar: model.text().nullable(),
  has_prescription: model.boolean().default(false),
  qty: model.number().default(1),
  list_cents: model.number(),
  discount_cents: model.number().default(0),
  tax_cents: model.number().default(0),
  frame_cents: model.number().default(0),
  lenses_cents: model.number().default(0),
  total_cents: model.number(),
  payment_methods: model.json().nullable(),
  status: model.enum(["active", "voided"]).default("active"),
  sold_at: model.dateTime(),
  /** Calendar day in the store's time zone: a 22:00 sale in Katy stays on its day. */
  sold_date_local: model.text(),
});
