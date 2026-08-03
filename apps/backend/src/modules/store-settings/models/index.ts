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
   * Additional administrators copied on every paid order, stored as a
   * comma-separated list. Kept as one text column rather than a child table on
   * purpose: it is a short list edited as a whole from a single admin field, and
   * a table would buy nothing but a join. Falls back to
   * STORE_ADMIN_NOTIFICATION_EMAILS when unset.
   */
  admin_notification_emails: model.text().nullable(),
  /**
   * Inbox that receives customer messages sent from the order-tracking page
   * (complaints, delays). Falls back to STORE_SUPPORT_EMAIL, then to the owner's
   * notification email, so the form is never a dead end.
   */
  support_email: model.text().nullable(),
  /**
   * Payment provider the storefront should offer at checkout, e.g.
   * "pp_stripe_stripe", "pp_paypal_paypal", "pp_square_square". The provider must
   * still be registered (with its credentials) in medusa-config; this only picks
   * which registered provider is active.
   */
  active_payment_provider: model.text().nullable(),
  /**
   * Sales-tax rate applied to FRAME-ONLY purchases (no prescription), as a
   * decimal string, e.g. "0.07" for 7%. Prescription eyewear is tax-exempt, so
   * it never uses this. Stored as text to avoid ORM numeric-precision surprises;
   * parsed and clamped to [0, 1] on read. Empty/unset = no frame tax.
   */
  frame_tax_rate: model.text().nullable(),
  /** Admin user who last changed the configuration. */
  updated_by: model.text().nullable(),
});
