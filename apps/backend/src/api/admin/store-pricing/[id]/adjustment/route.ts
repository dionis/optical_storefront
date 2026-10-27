import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../../../lib/establishments";
import { adjustmentDenied } from "../../../../../lib/store-pricing";
import { replaceRule } from "../../../../../lib/store-pricing-data";

/**
 * POST /admin/store-pricing/:id/adjustment { mode: "none"|"percent"|"delta", value }
 *
 * Ajuste general de la tienda sobre el precio base: un porcentaje sobre montura
 * y lentes, o un monto fijo que se suma una vez por venta. "none" lo quita.
 * Cierra el ajuste vigente y abre el nuevo (queda en el historial).
 */
export async function POST(
  req: AuthenticatedMedusaRequest<{ mode?: string; value?: unknown }>,
  res: MedusaResponse
): Promise<void> {
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as { mode?: string; value?: unknown };
  const mode = String(body.mode ?? "");

  if (!(await listEstablishments(req.scope)).some((e) => e.id === id)) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }
  const denied = adjustmentDenied(mode, body.value);
  if (denied) {
    res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid adjustment." });
    return;
  }

  const actorId = req.auth_context?.actor_id ?? null;
  await replaceRule(
    req.scope,
    { establishmentId: id, scope: "all", target: null, family: "adjustment" },
    mode === "none" ? null : { mode: mode as "percent" | "delta", value: Number(body.value), source: "panel" },
    actorId
  );
  req.scope
    .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
    .info(`[store-pricing] ${id}: adjustment ${mode} ${mode === "none" ? "" : Number(body.value)} by ${actorId ?? "?"}`);
  res.json({ ok: true });
}
