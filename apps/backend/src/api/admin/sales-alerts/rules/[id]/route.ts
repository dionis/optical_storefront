import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../lib/audit";
import { listRules, updateRule } from "../../../../../lib/alerts-data";
import { canConfigureAlerts, cleanRuleFor } from "../../../../../lib/alerts-route";
import { PosError } from "../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../lib/pos-route";

/**
 * POST /admin/sales-alerts/rules/:id — edits a rule (the whole rule; send
 * `is_active: false` to switch it off). A supervisor edits only their own and
 * cannot change its frequency.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!canConfigureAlerts(scope)) throw new PosError("forbidden_role", 403);
    const current = (await listRules(req.scope)).find((r) => r.id === String(req.params.id ?? ""));
    if (!current) throw new PosError("rule_not_found", 404);
    if (!scope.is_admin && current.created_by !== scope.user_id) throw new PosError("forbidden_role", 403);
    const body = { ...(req.body ?? {}) } as Record<string, unknown>;
    // A supervisor keeps the frequency the owner set.
    if (!scope.is_admin) { body.mode = current.mode; body.schedule = current.schedule; }
    const rule = await cleanRuleFor(req, scope, body);
    if (!scope.is_admin) { rule.mode = current.mode; rule.schedule = current.schedule; }
    await updateRule(req.scope, current.id, rule, scope.user_id);
    await recordAudit(req.scope, { actorId: scope.user_id, action: "alert.rule", entity: "alert_rule", entityId: current.id, before: current, after: rule });
    res.json({ rule: (await listRules(req.scope)).find((r) => r.id === current.id) });
  });
}
