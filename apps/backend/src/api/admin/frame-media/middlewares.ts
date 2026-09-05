import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http";
import { z } from "zod";
import { VIEW_SLOTS } from "../../../lib/frame-media";

const Kind = z.enum(["view", "video", "model3d"]);
const Slot = z.enum(VIEW_SLOTS);

/**
 * Enqueue declares INTENT, never a spend: it writes `pending` rows and returns
 * what they would cost. Nothing here calls a provider, which is why it needs no
 * budget check — `claim` is where the money is decided.
 */
export const EnqueueFrameMediaSchema = z.object({
  handles: z.array(z.string().min(1)).min(1).max(2000),
  kind: Kind.default("view"),
  slots: z.array(Slot).min(1).optional(),
  /** Restrict to named colourways; omit for all of them. */
  colorways: z.array(z.string().min(1)).optional(),
});
export type EnqueueFrameMediaSchema = z.infer<typeof EnqueueFrameMediaSchema>;

/**
 * The CLI's claim. `run_id` identifies one invocation so a lease can be
 * attributed and released; without it two terminals cannot be told apart.
 */
export const ClaimFrameMediaSchema = z.object({
  run_id: z.string().min(6).max(64),
  limit: z.number().int().min(1).max(100).default(8),
  kind: Kind.optional(),
  slots: z.array(Slot).optional(),
  handles: z.array(z.string().min(1)).optional(),
  /**
   * What the caller believes this batch will cost. The server prices it again
   * from its own tables — this is only used to fail fast, never to authorise.
   */
  estimated_usd: z.number().min(0).optional(),
});
export type ClaimFrameMediaSchema = z.infer<typeof ClaimFrameMediaSchema>;

/**
 * The CLI reporting one finished asset.
 *
 * `cost_usd` and the token counts come from the provider's own receipt. They are
 * recorded, not recomputed: the whole point of storing the receipt is being able
 * to reconcile against a bill weeks later.
 */
export const ReportFrameMediaSchema = z.object({
  run_id: z.string().min(6).max(64),
  id: z.string().min(1),
  status: z.enum(["done", "failed", "awaiting_external"]),
  output_key: z.string().min(1).optional(),
  output_bytes: z.number().int().min(0).optional(),
  output_mime: z.string().min(1).optional(),
  source_fingerprint: z.string().min(1).optional(),
  provider_model: z.string().optional(),
  operation: z.string().optional(),
  billing_unit: z.enum(["tokens", "seconds"]).optional(),
  tokens_prompt: z.number().int().min(0).optional(),
  tokens_output: z.number().int().min(0).optional(),
  cost_usd: z.number().min(0).optional(),
  receipt: z.record(z.string(), z.unknown()).optional(),
  /** Machine code. The panel maps it to `adm.media.err.<reason>`. */
  reason: z.string().max(64).optional(),
  /** English note for logs. Never shown to an operator. */
  note: z.string().max(2000).optional(),
});
export type ReportFrameMediaSchema = z.infer<typeof ReportFrameMediaSchema>;

export const UpdateFrameMediaBudgetSchema = z.object({
  daily_ceiling_usd: z.number().min(0).max(1000).optional(),
  max_batch_per_run: z.number().int().min(1).max(100).optional(),
  max_concurrency: z.number().int().min(1).max(8).optional(),
  video_scope: z.enum(["list", "all"]).optional(),
  video_sku_list: z.array(z.string().min(1)).max(2000).optional(),
  video_unit: z.enum(["product", "colorway"]).optional(),
  video_prompt: z.string().max(2000).nullable().optional(),
});
export type UpdateFrameMediaBudgetSchema = z.infer<typeof UpdateFrameMediaBudgetSchema>;

/**
 * Tier changes are the single most expensive click in the panel: level 3 lifts
 * the frame cap entirely. The target level is explicit so a stale page cannot
 * "advance" twice by double-submitting.
 */
export const UpdateFrameMediaTierSchema = z.object({
  tier: z.number().int().min(0).max(3),
});
export type UpdateFrameMediaTierSchema = z.infer<typeof UpdateFrameMediaTierSchema>;

export const PublishFrameMediaSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000).optional(),
  handles: z.array(z.string().min(1)).min(1).max(2000).optional(),
  kind: Kind.optional(),
  published: z.boolean().default(true),
});
export type PublishFrameMediaSchema = z.infer<typeof PublishFrameMediaSchema>;

export const RetryFrameMediaSchema = z.object({
  ids: z.array(z.string().min(1)).max(1000).optional(),
  handles: z.array(z.string().min(1)).max(2000).optional(),
  kind: Kind.optional(),
  slots: z.array(Slot).optional(),
  /** Requeue even a non-retryable failure. For after the cause has been fixed. */
  force: z.boolean().default(false),
});
export type RetryFrameMediaSchema = z.infer<typeof RetryFrameMediaSchema>;

export const frameMediaMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/frame-media/enqueue",
    method: "POST",
    middlewares: [validateAndTransformBody(EnqueueFrameMediaSchema)],
  },
  {
    matcher: "/admin/frame-media/claim",
    method: "POST",
    middlewares: [validateAndTransformBody(ClaimFrameMediaSchema)],
  },
  {
    matcher: "/admin/frame-media/report",
    method: "POST",
    middlewares: [validateAndTransformBody(ReportFrameMediaSchema)],
  },
  {
    matcher: "/admin/frame-media/budget",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateFrameMediaBudgetSchema)],
  },
  {
    matcher: "/admin/frame-media/tier",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateFrameMediaTierSchema)],
  },
  {
    matcher: "/admin/frame-media/retry",
    method: "POST",
    middlewares: [validateAndTransformBody(RetryFrameMediaSchema)],
  },
  {
    matcher: "/admin/frame-media/publish",
    method: "POST",
    middlewares: [validateAndTransformBody(PublishFrameMediaSchema)],
  },
];
