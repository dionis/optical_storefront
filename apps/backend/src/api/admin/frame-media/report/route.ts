import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { FRAME_MEDIA_MODULE } from "../../../../modules/frame-media/index";
import type FrameMediaModuleService from "../../../../modules/frame-media/service";
import { isRetryable, MAX_ATTEMPTS } from "../../../../lib/frame-media";
import type { ReportFrameMediaSchema } from "../middlewares";

/**
 * POST /admin/frame-media/report — the CLI reporting one finished asset.
 *
 * Writes the receipt as the provider gave it. Costs are RECORDED here, never
 * recomputed: the point of keeping `cost.json` is to reconcile against a bill
 * weeks later, and a figure this route derived itself could not do that.
 *
 * Sending `operation` alone (with status still unfinished) is legal and is how a
 * video run persists its Veo operation name BEFORE it starts polling — a Ctrl-C
 * three minutes in then resumes that operation instead of paying for another.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<ReportFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;
  const svc = req.scope.resolve<FrameMediaModuleService>(FRAME_MEDIA_MODULE);

  const existing = (await svc.listFrameMediaAssets({ id: body.id })) as unknown as
    | Record<string, unknown>[]
    | undefined;
  const current = existing?.[0];
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
  // straight to the attempt ceiling. Retrying it only buries the real cause
  // behind three identical failures — the same contract gemini_media.py states
  // when it refuses to retry a 403 or 404.
  const nextAttempts = failed
    ? isRetryable(body.reason)
      ? attempts + 1
      : MAX_ATTEMPTS
    : attempts;

  const update: Record<string, unknown> = {
    id: body.id,
    status: body.status,
    attempts: nextAttempts,
    lease_until: null,
    claimed_by: null,
    finished_at: body.status === "awaiting_external" ? null : new Date(),
    last_error_reason: failed ? (body.reason ?? "unknown") : null,
    last_error_note: failed ? (body.note ?? null) : null,
  };

  for (const field of [
    "output_key",
    "output_bytes",
    "output_mime",
    "source_fingerprint",
    "provider_model",
    "operation",
    "billing_unit",
    "tokens_prompt",
    "tokens_output",
    "cost_usd",
    "receipt",
  ] as const) {
    if (body[field] !== undefined) update[field] = body[field];
  }

  await svc.updateFrameMediaAssets(update);

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
