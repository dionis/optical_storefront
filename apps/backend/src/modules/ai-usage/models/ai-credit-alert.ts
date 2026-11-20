import { model } from "@medusajs/framework/utils";

/**
 * "Warn me when Gemini has $10 left" (unit usd), "…20 % left" (percent of what
 * was loaded) or "…7 days left at the current pace" (days).
 *
 * Fires once per funding cycle: `fired_cycle` holds the id of the latest
 * credit entry when it went out, so the next deposit re-arms it.
 * Empty `recipients` = the store's admin notification list.
 *
 * Configuration — never purged.
 */
export const AiCreditAlert = model.define("ai_credit_alert", {
  id: model.id({ prefix: "aial" }).primaryKey(),
  provider: model.text(),
  /** usd | percent | days */
  unit: model.text().default("usd"),
  threshold: model.float(),
  recipients: model.json().nullable(),
  locale: model.text().default("es"),
  is_active: model.boolean().default(true),
  fired_cycle: model.text().nullable(),
  fired_at: model.dateTime().nullable(),
  created_by: model.text().nullable(),
});
