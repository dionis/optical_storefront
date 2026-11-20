import { model } from "@medusajs/framework/utils";

/**
 * What the owner put into a provider account.
 *
 *   deposit  "I loaded $50 into Gemini on the 3rd" — adds to the balance.
 *   balance  "The console says I have $41.20 today" — RESETS the balance to
 *            that figure at that moment; spending before it no longer counts.
 *
 * The balance the panel shows is the owner's figure minus what this system
 * measured since. Configuration — never purged.
 */
export const AiCreditEntry = model.define("ai_credit_entry", {
  id: model.id({ prefix: "aicr" }).primaryKey(),
  provider: model.text(),
  /** deposit | balance */
  kind: model.text().default("deposit"),
  amount_usd: model.float(),
  effective_at: model.dateTime(),
  note: model.text().nullable(),
  created_by: model.text().nullable(),
});
