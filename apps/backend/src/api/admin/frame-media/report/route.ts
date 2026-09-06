import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { applyReport, getAsset } from "../../../../lib/frame-media-writes";
import { isRetryable, MAX_ATTEMPTS } from "../../../../lib/frame-media";
import type { ReportFrameMediaSchema } from "../middlewares";

/**
 * POST /admin/frame-media/report — the CLI reporting one finished asset.
 *
 * Writes the receipt as the provider gave it. Costs are RECORDED here, never
 * recomputed: the point of keeping `cost.json` is to reconcile against a bill
 * weeks later, and a figure this route derived itself could not do that.
 *
 * Sending `operation` alone (with status `awaiting_external`) is legal and is how
 * a video run persists its Veo operation name BEFORE it starts polling — a Ctrl-C
 * three minutes in then resumes that operation instead of paying for another.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<ReportFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;

  const current = await getAsset(req.scope, body.id);
  if (!current) {
    res.status(404).json({ reason: "unknown_asset", message: "Asset not found." });
    return;
  }

  // A report from a run that no longer holds the lease is refused rather than
  // applied. Otherwise a stalled run waking up after its lease expired would
  // overwrite whatever the run that legitimately took over has since written.
  if (current["claimed_by"] && current["claimed_by"] !== body.run_id) {
    res.status(409).json({
      reason: "lease_lost",
      message: "This asset is leased to another run.",
      claimed_by: current["claimed_by"],
    });
    return;
  }

  const attempts = Number(current["attempts"] ?? 0);
  const failed = body.status === "failed";

  // A non-retryable reason (bad key, unknown model, no source photo) is burned
  // straight to the attempt ceiling. Retrying it only buries the real cause behind
  // three identical failures — the same contract gemini_media.py states when it
  // refuses to retry a 403 or 404.
  const nextAttempts = failed
    ? isRetryable(body.reason)
      ? attempts + 1
      : MAX_ATTEMPTS
    : attempts;

  await applyReport(req.scope, {
    id: body.id,
    status: body.status,
    attempts: nextAttempts,
    output_key: body.output_key,
    output_bytes: body.output_bytes,
    output_mime: body.output_mime,
    source_fingerprint: body.source_fingerprint,
    provider_model: body.provider_model,
    operation: body.operation,
    billing_unit: body.billing_unit,
    tokens_prompt: body.tokens_prompt,
    tokens_output: body.tokens_output,
    cost_usd: body.cost_usd,
    receipt: body.receipt,
    reason: body.reason,
    note: body.note,
  });

  if (body.cost_usd) {
    console.info(
      JSON.stringify({
        event: "frame_media.billed",
        asset_id: body.id,
        kind: current["kind"],
        slot: current["slot"],
        handle: current["product_handle"],
        cost_usd: body.cost_usd,
        billing_unit: body.billing_unit,
        provider_model: body.provider_model,
        run_id: body.run_id,
        timestamp: new Date().toISOString(),
      })
    );
  }

  res.json({ id: body.id, status: body.status, attempts: nextAttempts });
}
