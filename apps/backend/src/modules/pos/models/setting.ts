import { model } from "@medusajs/framework/utils";

/**
 * Point-of-sale settings, one row (id "default"), set by the owner or a
 * superadmin: discount limits per role (HU-16) and the thresholds that flag an
 * optical change as significant (HU-123). Defaults live in src/lib/pos-settings.ts.
 */
export const PosSetting = model.define("pos_setting", {
  id: model.id().primaryKey(),
  discount_limits: model.json().nullable(),
  optical_thresholds: model.json().nullable(),
  /** Lab surcharges for high powers (lib/lab-surcharge.ts); null = the defaults. */
  lab_surcharges: model.json().nullable(),
  /** Days back each role may date a sale (lib/sale-date.ts); null = a year for all. */
  backdate_limits: model.json().nullable(),
  updated_by: model.text().nullable(),
});
