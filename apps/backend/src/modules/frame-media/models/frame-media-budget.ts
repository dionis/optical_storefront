import { model } from "@medusajs/framework/utils";

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
