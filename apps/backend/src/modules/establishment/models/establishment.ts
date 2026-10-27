import { model } from "@medusajs/framework/utils";

/**
 * A physical store (establecimiento) that sells through the point of sale.
 *
 * `code` is the owner's identifier — Op1, Op2, Op3… (Op1 = the main store) —
 * and the prefix of every sale, terminal and tray number of that store. It is
 * assigned once by src/lib/establishments.ts and never reused or changed.
 *
 * Each store gets its own Medusa sales channel at creation, so its sales are
 * separable in Medusa's own reports as well as ours.
 *
 * The receipt carries the business data (src/lib/tenant.ts) and only the store
 * NAME varies (owner's decision); address and phone are informational.
 *
 * A store with history is never deleted, only deactivated (HU-01).
 * Configuration, not order data — never purged by purge-orders.
 */
export const Establishment = model.define("establishment", {
  id: model.id({ prefix: "est" }).primaryKey(),
  code: model.text(),
  name: model.text(),
  address: model.text().nullable(),
  phone: model.text().nullable(),
  sales_channel_id: model.text().nullable(),
  /** own | family | partner | consignment — for the settlement with the store. */
  kind: model.enum(["own", "family", "partner", "consignment"]).default("own"),
  /** Warranty and exchange policy printed on this store's receipts (HU-104). */
  receipt_note: model.text().nullable(),
  /** Share of the net sales the store keeps in the settlement (HU-33); null = none. */
  settlement_pct: model.float().nullable(),
  is_active: model.boolean().default(true),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});
