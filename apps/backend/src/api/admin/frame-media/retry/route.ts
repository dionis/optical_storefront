import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { FRAME_MEDIA_MODULE } from "../../../../modules/frame-media/index";
import type FrameMediaModuleService from "../../../../modules/frame-media/service";
import { isRetryable } from "../../../../lib/frame-media";
import type { RetryFrameMediaSchema } from "../middlewares";

/**
 * POST /admin/frame-media/retry — put failed assets back in the queue.
 *
 * Resetting `attempts` to zero is the whole job, and it is why this is a route
 * rather than a loop of `report` calls: reporting a failure INCREMENTS attempts,
 * so a retry built that way would push assets past the ceiling instead of
 * clearing it.
 *
 * Assets that failed for a non-retryable reason (bad key, unknown model, no
 * source photo) are left alone unless `force` is set. Requeueing them without
 * fixing the cause just spends three more attempts reaching the same wall.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<RetryFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;
  const svc = req.scope.resolve<FrameMediaModuleService>(FRAME_MEDIA_MODULE);

  const filters: Record<string, unknown> = { status: ["failed"] };
  if (body.ids?.length) filters.id = body.ids;
  if (body.handles?.length) filters.product_handle = body.handles;
  if (body.kind) filters.kind = body.kind;
  if (body.slots?.length) filters.slot = body.slots;

  const rows = (await svc.listFrameMediaAssets(filters, {
    take: null,
  })) as unknown as Record<string, unknown>[];

  const eligible = rows.filter(
    (row) => body.force || isRetryable(row["last_error_reason"] as string | null)
  );
  const blocked = rows.length - eligible.length;

  if (eligible.length) {
    await svc.updateFrameMediaAssets(
      eligible.map((row) => ({
        id: row["id"] as string,
        status: "pending" as const,
        attempts: 0,
        lease_until: null,
        claimed_by: null,
        last_error_reason: null,
        last_error_note: null,
      }))
    );
  }

  console.info(
    JSON.stringify({
      event: "frame_media.retried",
      requeued: eligible.length,
      blocked_non_retryable: blocked,
      admin_user_id: req.auth_context.actor_id,
      timestamp: new Date().toISOString(),
    })
  );

  res.json({
    requeued: eligible.length,
    /** Left alone: retrying these reaches the same wall three more times. */
    blocked_non_retryable: blocked,
  });
}
