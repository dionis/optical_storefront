import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { findSellerById, projectSeller, sellerService } from "../../../../../lib/sellers";

/**
 * POST /admin/sellers/:id/rotate-link — invalidate the seller's dashboard
 * link. Bumps `token_version`; every link signed for an older version stops
 * verifying. Returns the seller with the fresh `dashboard_url`.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  try {
    const current = await findSellerById(req.scope, id);
    if (!current) {
      res.status(404).json({ type: "not_found", reason: "not_found", message: `Seller '${id}' not found.` });
      return;
    }
    const token_version = current.token_version + 1;
    const [updated] = (await sellerService(req.scope).updateSellers([{ id, token_version }])) as unknown as Record<string, unknown>[];
    console.info(JSON.stringify({ event: "seller.link_rotated", seller_id: id, token_version, admin_user_id: req.auth_context?.actor_id ?? null, timestamp: new Date().toISOString() }));
    res.json({ seller: projectSeller(updated ?? { ...current, token_version }) });
  } catch (error) {
    logger.error(`[sellers] rotate-link ${id} failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "rotate_failed", message: "Could not rotate the link." });
  }
}
