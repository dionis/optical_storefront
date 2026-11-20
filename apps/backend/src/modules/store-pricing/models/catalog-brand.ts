import { model } from "@medusajs/framework/utils";

/**
 * The BRAND REGISTRY of «Productos y precios» (docs/PRICE-MATRIX.md, v2 —
 * «Marcas»): one row per brand the shop sells, with its display name, its logo
 * and whether it is a frame or a case brand.
 *
 *  - `slug` is the catalogue's `metadata.brand_slug` ("di-caprio", "4u") —
 *    the key every price rule, discount and assortment rule of a brand uses.
 *    One live row per slug (partial unique index in the migration).
 *  - `logo_url` is either an absolute URL (an upload, lib/image-url.ts) or a
 *    path on the panel's own origin (`/brands/logo-di-caprio.png`, served by
 *    the storefront): stored as is, the panel prefixes nothing.
 *  - `source`: `capri` for a brand of the supplier's catalogue (seeded, or
 *    registered the first time the catalogue shows it), `manual` for one the
 *    owner added.
 *  - `active` false hides the brand from «Añadir montura»; its models stay.
 *
 * The catalogue stays the truth about which brands EXIST: a brand some model
 * carries but the registry lacks is registered on read (lib/catalog-brand-data.ts),
 * so it can never vanish from the screen. Configuration — never purged with
 * the orders.
 */
export const CatalogBrand = model.define("catalog_brand", {
  id: model.id({ prefix: "cbr" }).primaryKey(),
  slug: model.text(),
  name: model.text(),
  logo_url: model.text().nullable(),
  kind: model.enum(["frame", "case"]).default("frame"),
  source: model.enum(["capri", "manual"]).default("capri"),
  active: model.boolean().default(true),
  sort: model.number().default(0),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});
