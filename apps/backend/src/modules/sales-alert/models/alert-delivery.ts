import { model } from "@medusajs/framework/utils";

/**
 * One alert to one address (HU-44: the history of alerts sent and whether
 * they went out). Unique per (rule, event, recipient): a retried subscriber
 * never mails twice. In a batched mode the row waits as "queued" until the
 * rule's next summary.
 *
 * `payload` holds the event's display data (sale number, store, amounts,
 * seller code) — never prescription or insurance data.
 */
export const AlertDelivery = model.define("alert_delivery", {
  id: model.id({ prefix: "ald" }).primaryKey(),
  rule_id: model.text(),
  event: model.text(),
  event_key: model.text(),
  recipient_email: model.text(),
  status: model.enum(["queued", "sent", "failed"]).default("queued"),
  error: model.text().nullable(),
  payload: model.json().nullable(),
  sent_at: model.dateTime().nullable(),
});
