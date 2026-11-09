import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listLensMaterials } from "../../../../lib/lens-design-data";
import { matrixAccess } from "../../../../lib/price-matrix-route";

/**
 * GET /admin/pricing/lens-materials → { materials: [{ code, label_es, label_en, max_abs, is_active }] }
 * Every material of the master list, for the «add a material» picker of a
 * lens design. Owner and superadmin only (`forbidden_role`).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can list lens materials." });
    return;
  }
  res.json({ materials: await listLensMaterials(req.scope) });
}
