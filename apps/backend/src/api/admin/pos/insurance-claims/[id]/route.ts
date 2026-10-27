import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listClaims, PosError, setClaimStatus } from "../../../../../lib/pos-data";
import { managesStore, posHandler, posScope } from "../../../../../lib/pos-route";

/**
 * POST /admin/pos/insurance-claims/:id — { status: "submitted" | "paid" |
 * "rejected", paid? } marks what the insurer did (HU-114). Owner, superadmin
 * or the store's manager.
 */
interface Body {
  status?: string;
  paid?: number;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const id = String(req.params.id ?? "");
    const [claim] = (await listClaims(req.scope, { establishmentIds: null })).filter((c) => c.id === id);
    if (!claim) throw new PosError("claim_not_found", 404);
    if (!managesStore(scope, claim.establishment_id)) throw new PosError("forbidden_role", 403);
    const body = (req.body ?? {}) as Body;
    if (body.status !== "submitted" && body.status !== "paid" && body.status !== "rejected") throw new PosError("bad_status");
    let paidCents: number | null = null;
    if (body.status === "paid" && body.paid !== undefined) {
      const n = Number(body.paid);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw new PosError("bad_payment");
      paidCents = Math.round(n * 100);
    }
    await setClaimStatus(req.scope, id, body.status, paidCents, scope.user_id);
    res.json({ claims: (await listClaims(req.scope, { establishmentIds: [claim.establishment_id] })).filter((c) => c.sale_id === claim.sale_id) });
  });
}
