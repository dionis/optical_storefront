import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { findSellerById, projectSeller, sellerService } from "../../../../lib/sellers";
import { SellerInputError, validateSellerBody, type SellerBody } from "../route";
import { invalidateStaffScope, writeStaffAssignment } from "../../../../lib/staff-scope";

/**
 *   PATCH  /admin/sellers/:id — partial update → { seller }.
 *   DELETE /admin/sellers/:id — soft delete → { id, deleted: true }. The code
 *                               is freed; past orders keep their seller_code.
 *                               Refused while a panel user sells as this
 *                               seller (reason `seller_linked`).
 *
 * A record linked to a panel user drives that user: changing its store moves
 * their Equipo store with it, and deactivating it stops them at the counter.
 */

export async function PATCH(req: AuthenticatedMedusaRequest<SellerBody>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as SellerBody;
  try {
    const current = await findSellerById(req.scope, id);
    if (!current) throw new SellerInputError("not_found", `Seller '${id}' not found.`, 404);
    const data = await validateSellerBody(req, body, current);
    const svc = sellerService(req.scope);
    const [updated] = (await svc.updateSellers([{ id, ...data }])) as unknown as Record<string, unknown>[];
    if (current.user_id) {
      const store = (data["establishment_id"] as string | null | undefined) ?? current.establishment_id;
      if (store && store !== current.establishment_id) {
        await writeStaffAssignment(req.scope, { userId: current.user_id, role: "seller", establishmentIds: [store], actorId: req.auth_context?.actor_id ?? null });
      }
      invalidateStaffScope(current.user_id);
    }
    res.json({ seller: projectSeller(updated ?? { ...current, ...data }) });
  } catch (error) {
    if (error instanceof SellerInputError) {
      res.status(error.status).json({ type: "invalid_data", reason: error.reason, message: error.message });
      return;
    }
    logger.error(`[sellers] update ${id} failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "update_failed", message: "Could not update the seller." });
  }
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  try {
    const current = await findSellerById(req.scope, id);
    if (!current) {
      res.status(404).json({ type: "not_found", reason: "not_found", message: `Seller '${id}' not found.` });
      return;
    }
    if (current.user_id) {
      res.status(409).json({ type: "not_allowed", reason: "seller_linked", message: "A panel user sells as this seller; change their role or delete them first." });
      return;
    }
    await sellerService(req.scope).softDeleteSellers([id]);
    console.info(JSON.stringify({ event: "seller.deleted", seller_id: id, code: current.code, admin_user_id: req.auth_context?.actor_id ?? null, timestamp: new Date().toISOString() }));
    res.json({ id, deleted: true });
  } catch (error) {
    logger.error(`[sellers] delete ${id} failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "delete_failed", message: "Could not delete the seller." });
  }
}
