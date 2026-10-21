import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { StageError, transitionOrderStage } from "../../../../../lib/order-stage-transition";

/**
 * POST /admin/order-board/:id/stage — move an order to the next stage.
 *
 * One endpoint, one vocabulary. The panel says "this order is now in transit"
 * and the server works out that this means creating a shipment on a specific
 * fulfillment with specific quantities. That translation lives in
 * `lib/order-stage-transition.ts` (shared with the Google Sheet watcher, which
 * applies the same rules when the owner edits "Estado" in the sheet) rather
 * than in the browser: it is the only place that can see the fulfillment
 * records the operation needs, and a panel that had to orchestrate
 * `createFulfillment → createShipment → markAsDelivered` itself would be
 * reimplementing Medusa's admin API in a React component.
 *
 * The stages are NOT symmetrical, and the asymmetry is the point:
 *   • `confirmed` / `in_lab` are a manual note (`metadata.lab_stage`). The lab
 *     has no digital trail, so the owner sets it, and can unset it — but only
 *     while nothing has been fulfilled.
 *   • `shipped` / `in_transit` / `delivered` are real events with records behind
 *     them. They only move forward. Undoing one is a cancellation or a return,
 *     which is a different (and human) conversation.
 *
 * Body: { stage, tracking_number?, tracking_url?, no_notification? }
 *
 * Every refusal carries a `reason` code: the panel is bilingual and this route
 * is not, so the code is the contract and the panel owns the wording
 * (`adm.err.stage.*`); `message` stays as an English developer note.
 */

interface StageBody {
  stage?: string;
  /** Courier reference, recorded when moving to `in_transit`. */
  tracking_number?: string;
  /** Courier tracking PAGE (https URL) — goes in the customer email button. */
  tracking_url?: string;
  /** Skip the customer email/SMS for this transition. */
  no_notification?: boolean;
}

export async function POST(
  req: AuthenticatedMedusaRequest<StageBody>,
  res: MedusaResponse
): Promise<void> {
  const orderId = String(req.params.id ?? "");
  const body = (req.body ?? {}) as StageBody;
  try {
    const { after, notified } = await transitionOrderStage(req.scope, orderId, {
      stage: body.stage,
      actorId: req.auth_context?.actor_id ?? "",
      trackingNumber: body.tracking_number,
      trackingUrl: body.tracking_url,
      noNotification: body.no_notification === true,
    });
    res.status(200).json({ order: after, notified });
  } catch (error) {
    if (error instanceof StageError) {
      res.status(error.status).json({ type: "invalid_data", reason: error.reason, message: error.message, ...error.extra });
      return;
    }
    res.status(500).json({
      type: "error",
      message: `Could not move order to '${body.stage}'. ${(error as Error).message ?? ""}`.trim(),
    });
  }
}
