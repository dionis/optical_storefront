import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { updateOcrSettingsWorkflow } from "../../../workflows/update-ocr-settings";
import { allowedModelIds, resolveOcrSettings } from "../../../lib/ocr-settings";
import { OCR_MODELS, estimateOcrCost, getOcrModel } from "../../../lib/ocr-models";
import type { UpdateOcrSettingsSchema } from "./middlewares";

/**
 * Everything the admin UI needs to render the OCR configuration screen: the
 * active settings, the models this deployment permits, and what each one would
 * cost per read at the configured image size.
 */
function buildPayload(
  settings: Awaited<ReturnType<typeof resolveOcrSettings>>
) {
  const allowed = allowedModelIds();
  const models = OCR_MODELS.filter((m) => allowed.includes(m.id)).map((m) => ({
    ...m,
    estimate: estimateOcrCost(m, settings.max_image_px),
  }));

  const active = getOcrModel(settings.model_id);
  const escalation = settings.escalation_model_id
    ? getOcrModel(settings.escalation_model_id)
    : undefined;

  return {
    settings,
    models,
    estimate: {
      primary: active ? estimateOcrCost(active, settings.max_image_px) : null,
      escalation: escalation
        ? estimateOcrCost(escalation, settings.max_image_px)
        : null,
    },
  };
}

/** GET /admin/ocr-settings — current configuration + priced model catalogue. */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const settings = await resolveOcrSettings(req.scope);
  res.json(buildPayload(settings));
}

/** POST /admin/ocr-settings — switch model / escalation / image size. */
export async function POST(
  req: AuthenticatedMedusaRequest<UpdateOcrSettingsSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;

  await updateOcrSettingsWorkflow(req.scope).run({
    input: {
      model_id: body.model_id,
      escalation_model_id: body.escalation_model_id ?? null,
      max_image_px: body.max_image_px,
      updated_by: req.auth_context.actor_id,
    },
  });

  // Audit: model changes are spending changes.
  console.info(
    JSON.stringify({
      event: "ocr_settings.updated",
      model_id: body.model_id,
      escalation_model_id: body.escalation_model_id ?? null,
      max_image_px: body.max_image_px,
      admin_user_id: req.auth_context.actor_id,
      timestamp: new Date().toISOString(),
    })
  );

  const settings = await resolveOcrSettings(req.scope);
  res.json(buildPayload(settings));
}
