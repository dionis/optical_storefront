import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  ORDER_ACCESS_TTL_MS,
  issueToken,
  verifyToken,
} from "../../../../lib/order-access";

/**
 * POST /store/order-access/verify — trade the emailed link for a lasting session.
 *
 * The split matters: the magic token is short-lived because email is archived
 * and forwarded, while the session token returned here is what the storefront
 * keeps so the shopper never has to open their inbox again. Redeeming does not
 * consume the magic token (we hold no state), but its 30-minute life keeps the
 * exposure small.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as { token?: unknown };
  const verified = verifyToken(body.token, "magic");

  if (!verified) {
    // One message for expired, forged and malformed alike — see verifyToken.
    res.status(401).json({
      type: "unauthorized",
      message: "El enlace no es válido o ya caducó. Solicita uno nuevo.",
    });
    return;
  }

  res.status(200).json({
    token: issueToken(verified.email, "session"),
    email: verified.email,
    expires_in: ORDER_ACCESS_TTL_MS.session,
  });
}
