import { model } from "@medusajs/framework/utils";

/**
 * A seller (vendedor): someone who brings customers to the store through a
 * referral link and earns a commission on what they buy.
 *
 * Attribution is by `code`: the storefront reads `?ref=CODE` from the referral
 * link, keeps it, and writes it on the cart as `metadata.seller_code`; Medusa's
 * complete-cart workflow copies cart metadata onto the order verbatim, so the
 * order carries it with no extra plumbing. Stats group orders by that code.
 *
 * `token_version` is the revocation handle for the seller's dashboard link:
 * the link carries an HMAC token of (seller id, version); bumping the version
 * invalidates every previously issued link without touching any secret.
 *
 * Configuration, not order data — never purged by purge-orders.
 */
export const Seller = model.define("seller", {
  id: model.id({ prefix: "sel" }).primaryKey(),
  name: model.text(),
  email: model.text().nullable(),
  phone: model.text().nullable(),
  /**
   * Uppercase A-Z0-9, 3–12 chars. The referral code. Unique among live rows
   * (partial index in the migration; enforced in code so a soft-deleted seller
   * frees its code).
   */
  code: model.text(),
  /** Commission as a percentage of the attributed revenue (0–100). */
  commission_pct: model.float().default(0),
  active: model.boolean().default(true),
  /**
   * Store (establishment) and till (pos_terminal) the seller works from. An
   * active seller always has both, the till inside that store; an inactive one
   * may have neither. Enforced in code (`sellerPlacementProblem`), not by the
   * schema: the rule depends on `active`.
   */
  establishment_id: model.text().nullable(),
  terminal_id: model.text().nullable(),
  notes: model.text().nullable(),
  token_version: model.number().default(1),
  /** { instagram?, facebook?, tiktok?, whatsapp? } — handles the seller shares. */
  social: model.json().nullable(),
});
