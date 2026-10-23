import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { findSellerByCode } from "../../../../lib/sellers";

/**
 * GET /store/sellers/resolve?code=X — is this referral code real?
 *
 * The storefront calls it when it lands with `?ref=CODE` so it can show "you
 * were referred by Ana" and keep the code for the cart. Only the public name
 * travels; an inactive or unknown code is a 404 either way (no distinction —
 * the shopper gets a normal, unattributed checkout).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const code = String((req.query as Record<string, unknown>)["code"] ?? "");
  const seller = await findSellerByCode(req.scope, code);
  if (!seller || !seller.active) {
    res.status(404).json({ type: "not_found", reason: "unknown_code", message: "Unknown referral code." });
    return;
  }
  res.json({ code: seller.code, name: seller.name });
}
