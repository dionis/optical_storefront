import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";
import { cleanDeleteInput, deleteSale } from "../../../../../../lib/pos-sale-admin";
import { saleAdminDenied } from "../../../../../../lib/sale-permissions";

/**
 * POST /admin/pos/sales/:id/delete — { reason, note? }. Owner and superadmin
 * only (lib/sale-permissions.ts). Hides the sale everywhere and keeps it for
 * the audit trail; POST …/restore brings it back (lib/pos-sale-admin.ts).
 * Reasons: DELETE_REASONS; "other" needs a note.
 */
interface Body {
  reason?: string;
  note?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const denied = saleAdminDenied(scope);
    if (denied) throw new PosError(denied, 403);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const input = cleanDeleteInput((req.body ?? {}) as Body);
    if ("reason" in input) throw new PosError(input.reason);
    res.json({ sale: await deleteSale(req.scope, sale, scope.user_id, input.why, input.note) });
  });
}
