import { model } from "@medusajs/framework/utils";

/**
 * Runtime OCR configuration. A single row (id "default") holding the operator's
 * current choices, so a model can be swapped from the admin dashboard without a
 * redeploy. Env vars supply the values used until a row exists.
 *
 * This lives server-side on purpose: the model is a cost decision, so it must
 * never be selectable by whoever calls the public OCR endpoint.
 */
export const OcrSetting = model.define("ocr_setting", {
  id: model.id().primaryKey(),
  /** Model used for the first read attempt. */
  model_id: model.text(),
  /** Model retried when the first read looks unusable. Null disables escalation. */
  escalation_model_id: model.text().nullable(),
  /** Longest edge, in pixels, images are downscaled to before being sent. */
  max_image_px: model.number(),
  /** Admin user who last changed the configuration. */
  updated_by: model.text().nullable(),
});
