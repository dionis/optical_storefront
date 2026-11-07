import { model } from "@medusajs/framework/utils";

/**
 * The owner's own promotion on ONE article in ONE store: «Desc %» in the
 * «Productos y precios» matrix (docs/PRICE-MATRIX.md).
 *
 *  - `item_kind` says what `item_key` names: `frame` / `case` → the Medusa
 *    product id; `lens` → the `lens_store_price` base key (`lensBaseKey`);
 *    `photo` → `<code>:<sv|bifocal|prog>` (`lensPhotoKey`); `ar` → the AR
 *    option code (`lensArKey`). The very keys a store's lens price uses, so a
 *    price and its discount always name the same cell.
 *  - `pct` is 0–90 with two decimals. A row exists only while there IS a
 *    discount: clearing it (0 or null) soft-deletes the row, and the migration's
 *    partial unique index keeps one live row per (store, kind, key).
 *
 * The till applies it in `quoteSale` (lib/pos-data.ts) BEFORE the seller's
 * discount, which then works on the already reduced price. Configuration —
 * never purged with the orders.
 */
export const StoreItemDiscount = model.define("store_item_discount", {
  id: model.id({ prefix: "sidc" }).primaryKey(),
  establishment_id: model.text(),
  /** frame | case | lens | photo | ar */
  item_kind: model.text(),
  /** product_id, or the lens_store_price key of that kind. */
  item_key: model.text(),
  /** Percentage off, 0–90, two decimals. */
  pct: model.float(),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});
