import { model } from "@medusajs/framework/utils";

/**
 * One generated media asset for one product variant.
 *
 * GRANULARITY IS PER (variant, kind, slot), NOT PER PRODUCT. `gemini_media.py`
 * issues one API request per view precisely so a bad angle can be retried and
 * reported on its own — the failure mode is per-view (a model nails the profile
 * and invents a different frame for the rear). A row per product would throw
 * that away and make a retry cost four images instead of one.
 *
 * The unique index on (variant_sku, kind, slot) is what makes enqueueing
 * idempotent: the CLI and the panel and the scraper can all ask for the same
 * asset and only one row exists. See docs/frame-media-generation.md §5.
 */
export const FrameMediaAsset = model.define("frame_media_asset", {
  id: model.id().primaryKey(),

  // ── Identity ───────────────────────────────────────────────────────────────
  /** Medusa product handle, e.g. "dc-50-di-caprio". NOT the storefront seed slug. */
  product_handle: model.text(),
  /** Medusa variant SKU. The unit of work: colour is part of frame identity. */
  variant_sku: model.text(),
  /** Human-readable colourway ("Light Blue"), for the admin board. */
  colorway: model.text().nullable(),

  kind: model.enum(["view", "video", "model3d"]),
  /** front/left/right/back for views; null for video and model3d. */
  slot: model.enum(["front", "left", "right", "back"]).nullable(),

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  /**
   * `blocked_budget` is not a failure: the ceiling was reached, and the row goes
   * back to `pending` next month. `stale` means the source photo changed after
   * this asset was paid for — the old file keeps being served (an out-of-date
   * view beats a hole) until somebody deliberately regenerates.
   */
  status: model
    .enum([
      "pending",
      "running",
      "done",
      "failed",
      "stale",
      "awaiting_external",
      "blocked_budget",
      "skipped",
    ])
    .default("pending"),

  /**
   * Lease held by the run currently generating this asset. 20 minutes, because a
   * single Veo call can take 15 — a lease shorter than the slowest operation lets
   * a second run claim an asset that is still being generated, and it gets paid
   * for twice with neither run aware.
   */
  lease_until: model.dateTime().nullable(),
  /** `run_id` of the CLI invocation holding the lease. */
  claimed_by: model.text().nullable(),

  // ── Input ──────────────────────────────────────────────────────────────────
  /** Supplier photo this asset was generated from. */
  source_image_url: model.text().nullable(),
  /**
   * sha256(source bytes) + prompt version + model id. Ties the result to the
   * exact input that was paid for: same fingerprint and `done` means never pay
   * again; a different one marks the row `stale`.
   */
  source_fingerprint: model.text().nullable(),

  // ── Output ─────────────────────────────────────────────────────────────────
  /** R2 object key, e.g. "products/dc-50-di-caprio/views/dc-50_black_front.webp". */
  output_key: model.text().nullable(),
  output_bytes: model.number().nullable(),
  output_mime: model.text().nullable(),

  // ── Provenance and cost ────────────────────────────────────────────────────
  provider_model: model.text().nullable(),
  /** Veo operation name. Written BEFORE polling starts so a Ctrl-C can resume it. */
  operation: model.text().nullable(),
  /**
   * Images bill per token, video bills per second of output. Recorded explicitly
   * because a single "tokens used" number answers nothing across both halves —
   * and reporting zero tokens for a video reads as "this was free".
   */
  billing_unit: model.enum(["tokens", "seconds"]).nullable(),
  tokens_prompt: model.number().nullable(),
  tokens_output: model.number().nullable(),
  cost_usd: model.float().nullable(),
  /** The module's own cost.json, stored verbatim. */
  receipt: model.json().nullable(),

  // ── Failure ────────────────────────────────────────────────────────────────
  attempts: model.number().default(0),
  /** Machine code the panel turns into `adm.media.err.<reason>`. Never prose. */
  last_error_reason: model.text().nullable(),
  /** English note for logs. Not shown to the operator. */
  last_error_note: model.text().nullable(),

  // ── Publication ────────────────────────────────────────────────────────────
  /**
   * Separate from `status` on purpose. These views are INVENTED, not observed
   * (gemini_media.py says so in capitals), so generating and publishing are two
   * distinct acts and publishing is the owner's decision, never the pipeline's.
   */
  published: model.boolean().default(false),

  /** Admin actor_id, or "scraper" / "cli:<run_id>". */
  requested_by: model.text().nullable(),
  started_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),
});

/**
 * Runtime spending configuration. A single row (id "default"), mirroring the
 * ocr-config pattern: the model and the ceiling are cost decisions, so they live
 * server-side and are never selectable by whoever triggers a run.
 */
export const FrameMediaBudget = model.define("frame_media_budget", {
  id: model.id().primaryKey(),

  /**
   * Ladder position. Rises only by explicit admin action once the tier's
   * condition is met — never automatically. See §6.
   */
  tier: model.number().default(0),

  monthly_ceiling_usd_views: model.float().default(15),
  monthly_ceiling_usd_video: model.float().default(0),
  /** Second brake: caps the damage of a bad cron, not of a bad decision. */
  daily_ceiling_usd: model.float().default(10),
  /** Third brake: caps the damage of a bad loop. */
  max_batch_per_run: model.number().default(8),
  max_concurrency: model.number().default(2),

  /** `list` = explicit SKUs; `all` = seed the catalogue and drip under the ceiling. */
  video_scope: model.enum(["list", "all"]).default("list"),
  /** Handles for `video_scope = list`. */
  video_sku_list: model.json().nullable(),
  /** `product` = one video per frame; `colorway` = one per colourway. */
  video_unit: model.enum(["product", "colorway"]).default("product"),
  /** Editable prompt. NO_VOICEOVER_GUARD is appended by the module and is not editable. */
  video_prompt: model.text().nullable(),

  image_model_id: model.text().nullable(),
  video_model_id: model.text().nullable(),

  updated_by: model.text().nullable(),
});
