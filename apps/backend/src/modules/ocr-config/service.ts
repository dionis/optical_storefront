import { MedusaService } from "@medusajs/framework/utils";
import { OcrSetting } from "./models/index";

/**
 * CRUD only — the resolution rules (env defaults, allowlist validation) live in
 * `src/lib/ocr-settings.ts` and the update workflow, not here.
 */
export default class OcrConfigModuleService extends MedusaService({
  OcrSetting,
}) {}
