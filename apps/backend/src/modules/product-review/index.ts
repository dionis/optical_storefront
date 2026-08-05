import ProductReviewModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const PRODUCT_REVIEW_MODULE = "productReview";

export default Module(PRODUCT_REVIEW_MODULE, {
  service: ProductReviewModuleService,
});
