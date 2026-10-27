import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { AUDIT_ACTIONS, listAudit } from "../../../lib/audit";

/**
 * GET /admin/audit?action=&entity=&entity_id=&store=&limit= — registro de
 * auditoría (HU-72), lo más reciente primero. Solo dueño y superadmin: la ruta
 * no está en la lista de los roles restringidos.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const action = q.action && (AUDIT_ACTIONS as readonly string[]).includes(q.action) ? q.action : undefined;
  const events = await listAudit(
    req.scope,
    {
      action,
      entity: q.entity?.slice(0, 40) || undefined,
      entityId: q.entity_id?.slice(0, 80) || undefined,
      establishmentIds: q.store ? [q.store] : null,
    },
    Math.min(500, Number(q.limit) || 200)
  );
  res.json({ events, actions: AUDIT_ACTIONS });
}
