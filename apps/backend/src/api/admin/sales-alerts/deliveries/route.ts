import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listDeliveries, listRules } from "../../../../lib/alerts-data";
import { canConfigureAlerts } from "../../../../lib/alerts-route";
import { PosError } from "../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../lib/pos-route";

/**
 * GET /admin/sales-alerts/deliveries?rule=&status= — alerts sent and whether
 * they went out (HU-44). A supervisor sees those of their own rules.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!canConfigureAlerts(scope)) throw new PosError("forbidden_role", 403);
    const q = req.query as Record<string, string | undefined>;
    let ruleIds: string[] | null = scope.is_admin ? null : (await listRules(req.scope)).filter((r) => r.created_by === scope.user_id).map((r) => r.id);
    if (q.rule) ruleIds = ruleIds ? ruleIds.filter((id) => id === q.rule) : [q.rule];
    const status = q.status && ["queued", "sent", "failed"].includes(q.status) ? q.status : undefined;
    res.json({ deliveries: ruleIds && !ruleIds.length ? [] : await listDeliveries(req.scope, { ruleIds, status }) });
  });
}
