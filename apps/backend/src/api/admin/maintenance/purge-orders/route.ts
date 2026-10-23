import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { purgeOrders } from "../../../../lib/purge-orders";

/**
 * Puesta a cero de pedidos desde el panel (pestaña Seguridad → Zona de peligro).
 *
 *   GET  → informe: cuántas filas hay por tabla y cuántos archivos privados (no borra).
 *   POST { confirm: "BORRAR PEDIDOS" } → borra base de datos, bucket privado y hoja.
 *
 * Sesión de administrador obligatoria (prefijo /admin) y frase exacta de
 * confirmación: ni un clic accidental ni un script sin la frase pueden
 * ejecutarlo. Queda en el log quién lo hizo.
 */
export const CONFIRM_PHRASE = "BORRAR PEDIDOS";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(await purgeOrders(req.scope, false));
}

export async function POST(req: AuthenticatedMedusaRequest<{ confirm?: string }>, res: MedusaResponse): Promise<void> {
  if (String(req.body?.confirm ?? "").trim() !== CONFIRM_PHRASE) {
    res.status(400).json({ type: "invalid_data", reason: "confirm_phrase", message: `Body.confirm must be exactly "${CONFIRM_PHRASE}".` });
    return;
  }
  console.info(JSON.stringify({ event: "maintenance.purge_orders", admin_user_id: req.auth_context?.actor_id ?? null, timestamp: new Date().toISOString() }));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(await purgeOrders(req.scope, true));
}
