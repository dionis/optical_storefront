import { MedusaService } from "@medusajs/framework/utils";
import { ProductReview } from "./models/index";

/**
 * CRUD only — validation and the aggregate (average, count) live in the
 * workflow and the store route, matching how store-settings and ocr-config are
 * structured in this backend.
 */
export default class ProductReviewModuleService extends MedusaService({
  ProductReview,
}) {}
