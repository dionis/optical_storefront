import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { requeueAssets } from "../../../../lib/frame-media-writes";
import { NON_RETRYABLE_REASONS } from "../../../../lib/frame-media";
import type { RetryFrameMediaSchema } from "../middlewares";

/**
 * POST /admin/frame-media/retry — put failed assets back in the queue.
 *
 * Resetting `attempts` to zero is the whole job, and it is why this is a route
 * rather than a loop of `report` calls: reporting a failure INCREMENTS attempts,
 * so a retry built that way would push assets past the ceiling instead of
 * clearing it.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<RetryFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;

  const { requeued, blocked } = await requeueAssets(req.scope, {
    ids: body.ids,
    handles: body.handles,
    kind: body.kind,
    slots: body.slots,
    force: body.force,
    nonRetryable: [...NON_RETRYABLE_REASONS],
  });

  console.info(
    JSON.stringify({
      event: "frame_media.retried",
      requeued,
      blocked_non_retryable: blocked,
      forced: body.force,
      admin_user_id: req.auth_context.actor_id,
      timestamp: new Date().toISOString(),
    })
  );

  res.json({
    requeued,
    /** Left alone: retrying these reaches the same wall three more times. */
    blocked_non_retryable: blocked,
  });
}
