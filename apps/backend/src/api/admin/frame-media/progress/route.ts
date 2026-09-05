import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { progressCounts } from "../../../../lib/frame-media-claim";
import {
  resolveFrameMediaSettings,
  resolveSpend,
  tierFor,
  TIERS,
} from "../../../../lib/frame-media-settings";
import { estimateBatch } from "../../../../lib/frame-media-cost";
import { PILOT_HANDLES, PILOT_TOTALS } from "../../../../lib/frame-media-pilot";

/**
 * GET /admin/frame-media/progress — the "where is this up to" answer, for both
 * the panel's Media tab and the CLI's `media status`.
 *
 * Both read the same numbers on purpose: an operator looking at the browser and
 * an operator looking at a terminal on the server must never see two different
 * pictures of the same queue.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const scope = String(req.query.scope ?? "");
  const handles = scope === "pilot" ? PILOT_HANDLES : undefined;

  const [counts, settings, spend] = await Promise.all([
    progressCounts(req.scope, handles),
    resolveFrameMediaSettings(req.scope),
    resolveSpend(req.scope),
  ]);

  const byKind: Record<string, Record<string, number>> = {};
  for (const row of counts) {
    byKind[row.kind] ??= {};
    byKind[row.kind][row.status] = row.count;
  }

  // What the outstanding work would cost at today's rates. This is the number
  // that has to be visible BEFORE anyone authorises a batch — the same reason
  // /admin/ocr-settings prices every model next to the dropdown.
  const pendingViews =
    (byKind.view?.pending ?? 0) + (byKind.view?.failed ?? 0) + (byKind.view?.stale ?? 0);
  const pendingVideos =
    (byKind.video?.pending ?? 0) + (byKind.video?.failed ?? 0) + (byKind.video?.stale ?? 0);

  const outstanding = estimateBatch({
    views: pendingViews,
    videos: pendingVideos,
    videoModel: settings.video_model_id,
  });

  const tier = tierFor(settings.tier);

  res.json({
    scope: scope || "all",
    by_kind: byKind,
    outstanding: {
      views: pendingViews,
      videos: pendingVideos,
      estimate: outstanding,
    },
    spend: {
      ...spend,
      ceiling_usd_views: settings.monthly_ceiling_usd_views,
      ceiling_usd_video: settings.monthly_ceiling_usd_video,
      daily_ceiling_usd: settings.daily_ceiling_usd,
    },
    tier: {
      level: tier.level,
      label_key: tier.label_key,
      max_frames: tier.max_frames,
      advance_condition_key:
        TIERS.find((t) => t.level === tier.level + 1)?.advance_condition_key ?? null,
      next_level: TIERS.find((t) => t.level === tier.level + 1)?.level ?? null,
    },
    pilot: PILOT_TOTALS,
    settings: {
      max_batch_per_run: settings.max_batch_per_run,
      max_concurrency: settings.max_concurrency,
      video_scope: settings.video_scope,
      video_unit: settings.video_unit,
      image_model_id: settings.image_model_id,
      video_model_id: settings.video_model_id,
      source: settings.source,
    },
  });
}
