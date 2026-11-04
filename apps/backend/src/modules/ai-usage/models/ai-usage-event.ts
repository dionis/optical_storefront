import { model } from "@medusajs/framework/utils";

/**
 * One paid call to an AI provider: who (provider, model), for what (activity)
 * and what it cost. `cost_usd` is an ESTIMATE from the published rate table
 * the call was priced with (`rate_note`), unless the caller reported the
 * provider's own figure (`priced` = "reported").
 *
 * `status` = "no_credit" rows cost nothing: they record that the provider
 * refused a call for lack of balance, so the alert job can say so at once
 * (`notified_at` marks that it did).
 *
 * `event_key` makes recording idempotent — a polled job result or a retried
 * report is counted once. Never holds prompts, images or prescription data.
 *
 * History, not order data: never purged with orders.
 */
export const AiUsageEvent = model.define("ai_usage_event", {
  id: model.id({ prefix: "aiu" }).primaryKey(),
  provider: model.text(),
  model: model.text().nullable(),
  /** ocr | vision_measure | tryon_render | translation | media_views | media_video | other */
  activity: model.text(),
  /** ok | no_credit */
  status: model.text().default("ok"),
  input_tokens: model.number().nullable(),
  output_tokens: model.number().nullable(),
  cost_usd: model.float().default(0),
  /** estimated | reported | unpriced */
  priced: model.text().default("estimated"),
  rate_note: model.text().nullable(),
  event_key: model.text().nullable(),
  ref_id: model.text().nullable(),
  establishment_id: model.text().nullable(),
  notified_at: model.dateTime().nullable(),
});
