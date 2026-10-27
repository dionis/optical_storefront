import { model } from "@medusajs/framework/utils";

/**
 * A discount waiting for the owner or a superadmin (HU-16, HU-26): above the
 * seller's limit or under a minimum price. Only they decide it (owner's
 * decision, not delegable). It is bound to the quote it was asked for — the
 * sale must carry the same list total and percentage — and used once.
 *
 * `lines` keeps product titles and amounts for the decision email; never
 * customer or prescription data.
 */
export const DiscountApproval = model.define("discount_approval", {
  id: model.id({ prefix: "posdisc" }).primaryKey(),
  establishment_id: model.text(),
  terminal_id: model.text().nullable(),
  requested_by: model.text(),
  discount_pct: model.float(),
  limit_pct: model.float().nullable(),
  below_minimum: model.boolean().default(false),
  list_cents: model.number(),
  total_cents: model.number(),
  lines: model.json().nullable(),
  reason: model.text().nullable(),
  status: model.enum(["pending", "approved", "rejected", "used", "expired"]).default("pending"),
  decided_by: model.text().nullable(),
  decided_at: model.dateTime().nullable(),
  decision_note: model.text().nullable(),
  expires_at: model.dateTime(),
  sale_id: model.text().nullable(),
});
