import { MiddlewareRoute, validateAndTransformBody } from "@medusajs/framework/http";
import { z } from "zod";
import { MAX_IMAGE_PX_LIMIT, MIN_IMAGE_PX_LIMIT } from "../../../lib/ocr-settings";

export const UpdateOcrSettingsSchema = z.object({
  model_id: z.string().min(1),
  // null (or omitted) disables escalation entirely.
  escalation_model_id: z.string().min(1).nullable().optional(),
  max_image_px: z.number().int().min(MIN_IMAGE_PX_LIMIT).max(MAX_IMAGE_PX_LIMIT),
});

export type UpdateOcrSettingsSchema = z.infer<typeof UpdateOcrSettingsSchema>;

export const ocrSettingsMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/ocr-settings",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateOcrSettingsSchema)],
  },
];
