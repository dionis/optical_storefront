import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../lib/audit";
import { PosError } from "../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../lib/pos-route";
import { DEFAULT_DISCOUNT_LIMITS, getPosSettings, MAX_DISCOUNT_LIMIT, savePosSettings, settingsDenied } from "../../../../lib/pos-settings";
import { DEFAULT_THRESHOLDS } from "../../../../lib/optical-change";
import { DEFAULT_LAB_SURCHARGES } from "../../../../lib/lab-surcharge";
import { reconcileLabSurcharges } from "../../../../lib/sale-facts";
import { BACKDATE_CEILING, DEFAULT_BACKDATE_LIMITS } from "../../../../lib/sale-date";

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
      defaults: { discount_limits: DEFAULT_DISCOUNT_LIMITS, optical_thresholds: DEFAULT_THRESHOLDS, max_discount_limit: MAX_DISCOUNT_LIMIT, lab_surcharges: DEFAULT_LAB_SURCHARGES, backdate_limits: DEFAULT_BACKDATE_LIMITS, backdate_ceiling: BACKDATE_CEILING },
    });
  });
}

interface Body {
  discount_limits?: unknown;
  optical_thresholds?: unknown;
  /** Lab surcharges for high powers (lib/lab-surcharge.ts): the whole list as it must stay. */
  lab_surcharges?: unknown;
  /** Days back each role may date a sale: { seller?, manager?, supervisor? } (0–366). */
  backdate_limits?: unknown;
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
      before: { discount_limits: before.discount_limits, optical_thresholds: before.optical_thresholds, lab_surcharges: before.lab_surcharges, backdate_limits: before.backdate_limits },
      after: { discount_limits: after.discount_limits, optical_thresholds: after.optical_thresholds, lab_surcharges: after.lab_surcharges, backdate_limits: after.backdate_limits },
    });
    res.json({ settings: after });
    // The books follow the new surcharge rules, past sales included (after the answer: it can take a while).
    if (body.lab_surcharges !== undefined) void reconcileLabSurcharges(req.scope);
  });
}
