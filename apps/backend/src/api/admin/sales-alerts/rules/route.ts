import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../lib/audit";
import { createRule, listRules } from "../../../../lib/alerts-data";
import { canConfigureAlerts, cleanRuleFor } from "../../../../lib/alerts-route";
import { PosError } from "../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../lib/pos-route";

/**
 * REGLAS DE ALERTA (HU-41, HU-42).
 *
 *   GET  /admin/sales-alerts/rules — dueño y superadmin: todas; supervisor: las suyas.
 *   POST /admin/sales-alerts/rules — { name, event, conditions?, establishment_ids?,
 *        seller_ids?, recipients, mode?, schedule?, locale? }. Las direcciones
 *        las fija quien crea la regla; la frecuencia solo dueño o superadmin.
 *
 * Errores con `reason`; el panel traduce con adm.err.pos.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!canConfigureAlerts(scope)) throw new PosError("forbidden_role", 403);
    const rules = await listRules(req.scope);
    res.json({ rules: scope.is_admin ? rules : rules.filter((r) => r.created_by === scope.user_id), can_schedule: scope.is_admin });
  });
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!canConfigureAlerts(scope)) throw new PosError("forbidden_role", 403);
    const rule = await cleanRuleFor(req, scope, (req.body ?? {}) as Record<string, unknown>);
    const created = await createRule(req.scope, rule, scope.user_id);
    await recordAudit(req.scope, { actorId: scope.user_id, action: "alert.rule", entity: "alert_rule", entityId: created.id, after: rule });
    res.json({ rule: created });
  });
}
