import { MedusaService } from "@medusajs/framework/utils";
import { StoreSetting } from "./models/index";

/**
 * CRUD only — resolution rules (env defaults, validation) live in
 * `src/lib/store-settings.ts`, mirroring how ocr-config is structured.
 */
export default class StoreSettingsModuleService extends MedusaService({
  StoreSetting,
}) {}
