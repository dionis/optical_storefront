import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { OCR_CONFIG_MODULE } from "../../modules/ocr-config/index";
import type OcrConfigModuleService from "../../modules/ocr-config/service";
import {
  OCR_SETTING_ID,
  allowedModelIds,
  clampImagePx,
} from "../../lib/ocr-settings";

export interface UpsertOcrSettingsInput {
  model_id: string;
  escalation_model_id: string | null;
  max_image_px: number;
  updated_by: string | null;
}

/**
 * Writes the single OCR settings row, creating it on first use.
 *
 * Validation lives here rather than in the route: the model choice is a
 * spending decision, so the allowlist must hold for every caller of the
 * workflow, not just the HTTP one.
 */
export const upsertOcrSettingsStep = createStep(
  "upsert-ocr-settings",
  async (input: UpsertOcrSettingsInput, { container }) => {
    const allowed = allowedModelIds();

    if (!allowed.includes(input.model_id)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Model '${input.model_id}' is not in the allowed list (${allowed.join(", ")}).`
      );
    }
    if (
      input.escalation_model_id !== null &&
      !allowed.includes(input.escalation_model_id)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Escalation model '${input.escalation_model_id}' is not in the allowed list.`
      );
    }

    const svc = container.resolve<OcrConfigModuleService>(OCR_CONFIG_MODULE);
    const existing = (await svc.listOcrSettings({
      id: OCR_SETTING_ID,
    })) as unknown as Record<string, unknown>[];
    const previous = existing[0];

    const data = {
      id: OCR_SETTING_ID,
      model_id: input.model_id,
      escalation_model_id: input.escalation_model_id,
      max_image_px: clampImagePx(input.max_image_px),
      updated_by: input.updated_by,
    };

    if (previous) {
      await svc.updateOcrSettings(data);
    } else {
      await svc.createOcrSettings(data);
    }

    // Compensation payload: the row as it was, or null when we created it.
    return new StepResponse(data, previous ?? null);
  },
  async (previous, { container }) => {
    if (previous === undefined) return;
    const svc = container.resolve<OcrConfigModuleService>(OCR_CONFIG_MODULE);
    if (previous === null) {
      await svc.deleteOcrSettings(OCR_SETTING_ID);
      return;
    }
    await svc.updateOcrSettings({
      id: OCR_SETTING_ID,
      model_id: previous["model_id"] as string,
      escalation_model_id: previous["escalation_model_id"] as string | null,
      max_image_px: previous["max_image_px"] as number,
      updated_by: previous["updated_by"] as string | null,
    });
  }
);
