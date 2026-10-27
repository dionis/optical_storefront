import { model } from "@medusajs/framework/utils";

/**
 * A cost of a store, or of the whole business (establishment_id null) shared
 * among the stores (functional document E13, HU-91 to HU-95).
 *
 *  - kind fixed: paid whether or not anything sells (rent — only if the store
 *    pays one —, utilities, salaries, insurance, subscriptions, equipment);
 *  - kind variable: recorded by hand (supplies, shipping, repairs, remakes).
 *    Frames and lenses, payment fees and seller commissions are computed per
 *    sale and are not entered here.
 *  - frequency monthly | quarterly | annual | one_time; a one-time item can
 *    be spread over `amortize_months`.
 *  - allocation (shared items): { method: "percent", shares: { est_id: pct } }
 *    or { method: "sales" } — in proportion to what each store sold that month.
 *
 * Edited only with the costs.manage privilege; every change is audited with
 * before and after (HU-97). Deleted softly. Configuration — never purged.
 */
export const CostItem = model.define("cost_item", {
  id: model.id({ prefix: "cst" }).primaryKey(),
  establishment_id: model.text().nullable(),
  kind: model.enum(["fixed", "variable"]),
  category: model.text(),
  description: model.text().nullable(),
  amount_cents: model.number(),
  frequency: model.enum(["monthly", "quarterly", "annual", "one_time"]).default("monthly"),
  amortize_months: model.number().nullable(),
  starts_on: model.text(),
  ends_on: model.text().nullable(),
  vendor: model.text().nullable(),
  attachment_key: model.text().nullable(),
  allocation: model.json().nullable(),
  notes: model.text().nullable(),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});
