import { model } from "@medusajs/framework/utils";

/**
 * An alert rule (HU-41, HU-42): which event warns, about which stores, to
 * which email addresses and how often. Email only (owner's decision).
 *
 * `recipients` are addresses, not users: whoever creates or edits the rule
 * decides them, and there are no hidden recipients (HU-41).
 * `mode`/`schedule`: immediate | every_n_hours {hours 1–12} | daily {at "20:00"}
 * | weekly {weekday 0–6, at}, in the store's time zone (America/Chicago).
 * Only the owner or a superadmin changes the frequency.
 *
 * Configuration — never purged.
 */
export const AlertRule = model.define("alert_rule", {
  id: model.id({ prefix: "alr" }).primaryKey(),
  name: model.text(),
  /** sale.created | discount.applied | discount.requested | sale.below_min | sale.voided | cash.diff | store.idle | digest */
  event: model.text(),
  /** { min_total?, min_discount_pct?, idle_after?, include_web? } */
  conditions: model.json().nullable(),
  /** Stores the rule watches; null/empty = every store. */
  establishment_ids: model.json().nullable(),
  /** Sellers the rule watches; null/empty = everyone. */
  seller_ids: model.json().nullable(),
  recipients: model.json(),
  mode: model.enum(["immediate", "every_n_hours", "daily", "weekly"]).default("immediate"),
  schedule: model.json().nullable(),
  locale: model.text().default("es"),
  is_active: model.boolean().default(true),
  /** Last time a summary of this rule went out (digests and batched modes). */
  last_sent_at: model.dateTime().nullable(),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});
