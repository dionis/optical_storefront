import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../lib/audit";
import { PosError } from "../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../lib/pos-route";
import { DEFAULT_DISCOUNT_LIMITS, getPosSettings, MAX_DISCOUNT_LIMIT, savePosSettings, settingsDenied } from "../../../../lib/pos-settings";
import { DEFAULT_THRESHOLDS } from "../../../../lib/optical-change";

/**
 * AJUSTES DEL PUNTO DE VENTA.
 *
 *   GET  /admin/pos/settings — límites de descuento por rol y umbrales del
 *        daño óptico (todos los roles: la caja los usa para avisar).
 *   POST /admin/pos/settings — { discount_limits?, optical_thresholds? } solo
 *        dueño y superadmin (HU-16, HU-123). Límites entre 0 y 50 %.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    await posScope(req);
    res.json({
      settings: await getPosSettings(req.scope),
      defaults: { discount_limits: DEFAULT_DISCOUNT_LIMITS, optical_thresholds: DEFAULT_THRESHOLDS, max_discount_limit: MAX_DISCOUNT_LIMIT },
    });
  });
}

interface Body {
  discount_limits?: unknown;
  optical_thresholds?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!scope.is_admin) throw new PosError("forbidden_role", 403);
    const body = (req.body ?? {}) as Body;
    const denied = settingsDenied(body);
    if (denied) throw new PosError(denied);
    const { before, after } = await savePosSettings(req.scope, body, scope.user_id);
    await recordAudit(req.scope, {
      actorId: scope.user_id,
      action: "settings.change",
      entity: "pos_setting",
      entityId: "default",
      before: { discount_limits: before.discount_limits, optical_thresholds: before.optical_thresholds },
      after: { discount_limits: after.discount_limits, optical_thresholds: after.optical_thresholds },
    });
    res.json({ settings: after });
  });
}
