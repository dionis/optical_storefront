import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { claimAssets } from "../../../../lib/frame-media-claim";
import {
  checkBudget,
  resolveFrameMediaSettings,
  resolveSpend,
} from "../../../../lib/frame-media-settings";
import { estimateBatch } from "../../../../lib/frame-media-cost";
import { MediaKind } from "../../../../lib/frame-media";
import type { ClaimFrameMediaSchema } from "../middlewares";

/**
 * POST /admin/frame-media/claim — hand a run its next batch, leased.
 *
 * THIS IS WHERE THE MONEY IS DECIDED. The CLI shows the operator an estimate and
 * the panel shows one too, but neither is trusted: the ceiling is enforced here,
 * server-side, on every batch. A client that lies about `estimated_usd` gets the
 * server's own figure applied anyway.
 *
 * Returning an empty batch is a normal, successful answer — it is how the CLI
 * learns there is nothing left to do.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<ClaimFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;

  const settings = await resolveFrameMediaSettings(req.scope);
  const spend = await resolveSpend(req.scope);

  const limit = Math.min(body.limit, settings.max_batch_per_run);
  const kind = (body.kind ?? "view") as MediaKind;

  // Price the batch we are ABOUT to hand out, not the one the caller asked for:
  // `limit` may already have been cut down by max_batch_per_run above.
  const estimate = estimateBatch({
    views: kind === "view" ? limit : 0,
    videos: kind === "video" ? limit : 0,
    videoModel: settings.video_model_id,
  });

  const verdict = checkBudget({
    settings,
    spend,
    kind,
    estimatedUsd: estimate.total_usd,
    frames: body.handles?.length,
  });

  if (!verdict.allowed) {
    // 409, not 403: nothing is wrong with the request or the caller — the state
    // of the budget is what refuses. `reason` is a code; the panel turns it into
    // `adm.media.err.<reason>` and the CLI prints its own wording.
    res.status(409).json({
      reason: verdict.reason,
      message: `Budget check failed: ${verdict.reason}`,
      remaining_usd: verdict.remaining_usd,
      tier: settings.tier,
      spend,
    });
    return;
  }

  const assets = await claimAssets(req.scope, {
    runId: body.run_id,
    limit,
    kind,
    slots: body.slots,
    handles: body.handles,
  });

  res.json({
    run_id: body.run_id,
    assets,
    /** How much room is left before the next refusal — lets the CLI stop early. */
    remaining_usd: verdict.remaining_usd,
    concurrency: settings.max_concurrency,
    image_model_id: settings.image_model_id,
    video_model_id: settings.video_model_id,
    video_prompt: settings.video_prompt,
  });
}
