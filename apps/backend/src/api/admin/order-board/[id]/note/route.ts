import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IOrderModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { fetchBoardOrder } from "../../../../../lib/order-board";
import { syncOrderToSheet } from "../../../../../lib/gsheet-sync";

/**
 * POST /admin/order-board/:id/note — the owner's free-text note on an order.
 * Body: { note } (≤ 1000 chars; empty clears it). Stored on
 * `metadata.owner_note`, shown on the board and appended to the sheet's Notas
 * column ("nota" event, with its history row). Never sent to the customer.
 */
export const OWNER_NOTE_MAX = 1000;

export async function POST(req: AuthenticatedMedusaRequest<{ note?: string }>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  const raw = (req.body ?? {}) as { note?: unknown };
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== "string") {
    res.status(400).json({ type: "invalid_data", reason: "bad_note", message: "note must be a string." });
    return;
  }
  const note = String(raw.note ?? "").trim();
  if (note.length > OWNER_NOTE_MAX) {
    res.status(400).json({ type: "invalid_data", reason: "note_too_long", message: `note must be at most ${OWNER_NOTE_MAX} characters.` });
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
    const next: Record<string, unknown> = { ...current };
    if (note) next["owner_note"] = note;
    else delete next["owner_note"];
    const orders = req.scope.resolve<IOrderModuleService>(Modules.ORDER);
    await orders.updateOrders([{ id, metadata: next }]);

    console.info(JSON.stringify({
      event: "order_board.note_set",
      order_id: id,
      length: note.length,
      admin_user_id: req.auth_context?.actor_id ?? null,
      timestamp: new Date().toISOString(),
    }));
    await syncOrderToSheet(req.scope, id, "nota");
    const after = await fetchBoardOrder(req.scope, id);
    res.json({ order: after });
  } catch (error) {
    logger.error(`[order-board] note for ${id} failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "note_failed", message: "Could not save the note." });
  }
}
