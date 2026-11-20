import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../../lib/audit";
import { buildCashDocument } from "../../../../../../lib/cash-documents";
import { canSellAt } from "../../../../../../lib/pos";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../../lib/pos-route";

/**
 * GET /admin/pos/cash-sessions/:id/document?kind=open|close&print=1 — the
 * opening or closing document (lib/cash-documents.ts): store, who and when
 * with initials, float, cash by till and by person, refunds, manual in/out
 * by reason, expected / counted / difference, approval line and every ledger
 * line. The panel prints it two-up (two copies, cut line). `print=1` records
 * the print in the audit log (document.print).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    const kind = q.kind === "open" ? "open" : q.kind === "close" ? "close" : null;
    if (!kind) throw new PosError("bad_status");
    const document = await buildCashDocument(req.scope, String(req.params.id ?? ""), kind);
    if (!canSellAt(scope, document.store.id)) throw new PosError("forbidden_store", 403);
    if (q.print === "1") {
      await recordAudit(req.scope, { actorId: scope.user_id, action: "document.print", entity: "cash_session", entityId: document.session.id, establishmentId: document.store.id, after: { kind: `cash_${kind}_duo` } });
    }
    res.json({ document });
  });
}
