import { MedusaService } from "@medusajs/framework/utils";
import { FrameMediaAsset, FrameMediaBudget } from "./models/index";

/**
 * CRUD only — the rules live in `src/lib/frame-media*.ts`, the same split the
 * ocr-config module uses.
 *
 * The one thing that cannot be expressed as CRUD is the atomic claim (SELECT …
 * FOR UPDATE SKIP LOCKED + lease), which needs raw SQL; it lives in
 * `src/lib/frame-media-claim.ts` and runs through the shared pg connection.
 */
export default class FrameMediaModuleService extends MedusaService({
  FrameMediaAsset,
  FrameMediaBudget,
}) {}
