import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../lib/audit";
import { publicBrand } from "../../../../../lib/tenant-brand";
import { requireTenantAdmin } from "../../../../../lib/tenant-guard";
import { readTenantProfile, saveTenantProfile } from "../../../../../lib/tenant-profile";

/**
 * POST /admin/tenant/brand/revert — «Volver a la marca anterior»: la anterior
 * pasa a ser la actual y la actual queda como anterior, así que repetirlo lo
 * deshace. 409 `no_previous` si no hay nada que intercambiar.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = await requireTenantAdmin(req, res);
  if (!actorId) return;
  const before = await readTenantProfile(req.scope, { fresh: true });
  if (!before.brand_previous && !before.brand) {
    res.status(409).json({ type: "not_allowed", reason: "no_previous", message: "There is no previous brand." });
    return;
  }
  const profile = await saveTenantProfile(req.scope, { brand: before.brand_previous, brand_previous: before.brand }, actorId);
  await recordAudit(req.scope, {
    actorId,
    action: "tenant.brand",
    entity: "tenant_profile",
    entityId: "default",
    before: { brand: before.brand },
    after: { brand: profile.brand, reverted: true },
  });
  res.json({ brand: publicBrand(profile.brand), previous: profile.brand_previous });
}
