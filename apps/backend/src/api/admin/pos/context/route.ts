import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../lib/establishments";
import { sellableStores } from "../../../../lib/pos";
import { listPaymentMethods } from "../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../lib/pos-route";

/**
 * GET /admin/pos/context — what the till needs to open: the stores this user
 * may sell in, the active payment methods and the user's role. Open to every
 * panel role (lib/staff-roles.ts allowlist).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const [stores, methods] = await Promise.all([listEstablishments(req.scope), listPaymentMethods(req.scope)]);
    res.json({
      role: scope.role,
      is_admin: scope.is_admin,
      stores: sellableStores(scope, stores).map((s) => ({ id: s.id, code: s.code, name: s.name })),
      payment_methods: methods.filter((m) => m.is_active),
    });
  });
}
