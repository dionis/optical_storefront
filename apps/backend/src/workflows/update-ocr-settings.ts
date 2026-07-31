import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import {
  upsertOcrSettingsStep,
  type UpsertOcrSettingsInput,
} from "./steps/upsert-ocr-settings";

/** Changes which model reads prescriptions, and how large the images sent are. */
export const updateOcrSettingsWorkflow = createWorkflow(
  "update-ocr-settings",
  function (input: UpsertOcrSettingsInput) {
    const settings = upsertOcrSettingsStep(input);
    return new WorkflowResponse(settings);
  }
);
