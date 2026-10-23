import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IOrderModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { fetchBoardOrder } from "../../../../../lib/order-board";
import { sanitizeTrackingUrl } from "../../../../../lib/order-stage-transition";
import { syncOrderToSheet } from "../../../../../lib/gsheet-sync";

/**
 * POST /admin/order-board/:id/tracking — set the courier reference without
 * moving the stage. Body: { tracking_number, tracking_url? }.
 *
 * The same edit the sheet already allows in its "Guía (tracking)" column, now
 * from the panel: writes `metadata.tracking_number` / `tracking_url` (what
 * `/store/my-orders` shows the customer), records the event and refreshes the
 * sheet row ("guia"). It deliberately does NOT create a shipment — that is the
 * `in_transit` stage, with its own email.
 */
interface Body {
  tracking_number?: string;
  tracking_url?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as Body;
  const tracking = String(body.tracking_number ?? "").trim().slice(0, 120);
  const trackingUrl = sanitizeTrackingUrl(body.tracking_url);
  if (body.tracking_url && !trackingUrl) {
    res.status(400).json({ type: "invalid_data", reason: "bad_url", message: "tracking_url must be an http(s) URL." });
    return;
  }
  try {
    const before = await fetchBoardOrder(req.scope, id);
    if (!before) {
      res.status(404).json({ type: "not_found", reason: "not_found", message: `Order '${id}' not found.` });
      return;
    }
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({ entity: "order", fields: ["id", "metadata"], filters: { id } });
    const current = ((data?.[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current, tracking_number: tracking };
    if (body.tracking_url !== undefined) next["tracking_url"] = trackingUrl;
    const orders = req.scope.resolve<IOrderModuleService>(Modules.ORDER);
    await orders.updateOrders([{ id, metadata: next }]);

    console.info(JSON.stringify({
      event: "order_board.tracking_set",
      order_id: id,
      tracking_number: tracking || null,
      tracking_url: trackingUrl || null,
      admin_user_id: req.auth_context?.actor_id ?? null,
      timestamp: new Date().toISOString(),
    }));
    await syncOrderToSheet(req.scope, id, "guia", { number: tracking, url: trackingUrl || null });
    const after = await fetchBoardOrder(req.scope, id);
    res.json({ order: after });
  } catch (error) {
    logger.error(`[order-board] tracking for ${id} failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "tracking_failed", message: "Could not save the tracking number." });
  }
}
