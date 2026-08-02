import { model } from "@medusajs/framework/utils";

/**
 * Runtime store configuration the owner controls from the admin dashboard — a
 * single row (id "default"). Env vars supply the values used until a row exists,
 * so an un-migrated or un-configured deployment still behaves like today.
 *
 * Kept deliberately small: only settings a non-technical owner should be able to
 * change without a redeploy. Secrets (API keys) never live here — they stay in
 * the server environment; this row only records *choices* (which email, which
 * payment provider).
 */
export const StoreSetting = model.define("store_setting", {
  id: model.id().primaryKey(),
  /** Email that receives a copy of every paid order (the owner's inbox). */
  owner_notification_email: model.text().nullable(),
  /** Phone (E.164) that receives an SMS heads-up for every paid order. */
  owner_notification_sms: model.text().nullable(),
  /**
   * Payment provider the storefront should offer at checkout, e.g.
   * "pp_stripe_stripe", "pp_paypal_paypal", "pp_square_square". The provider must
   * still be registered (with its credentials) in medusa-config; this only picks
   * which registered provider is active.
   */
  active_payment_provider: model.text().nullable(),
  /** Admin user who last changed the configuration. */
  updated_by: model.text().nullable(),
});
