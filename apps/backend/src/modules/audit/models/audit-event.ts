import { model } from "@medusajs/framework/utils";

/**
 * Audit log (HU-72): who changed a price, applied or approved a discount,
 * voided a sale, changed permissions, edited a cost or reprinted a document.
 *
 * Insert-only: nothing updates or deletes a row (src/lib/audit.ts only
 * writes). `before`/`after` hold the values that changed — never prescription
 * values or other health data.
 *
 * Configuration history, not order data — never purged by purge-orders.
 */
export const AuditEvent = model.define("audit_event", {
  id: model.id({ prefix: "aud" }).primaryKey(),
  actor_user_id: model.text().nullable(),
  establishment_id: model.text().nullable(),
  /** "price.change", "sale.void", "discount.approve", "role.change"… (src/lib/audit.ts AUDIT_ACTIONS). */
  action: model.text(),
  entity: model.text(),
  entity_id: model.text().nullable(),
  before: model.json().nullable(),
  after: model.json().nullable(),
});
