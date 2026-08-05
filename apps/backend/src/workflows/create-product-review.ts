import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { PRODUCT_REVIEW_MODULE } from "../modules/product-review/index";
import type ProductReviewModuleService from "../modules/product-review/service";

export interface CreateProductReviewInput {
  product_handle: string;
  rating: number;
  body: string;
  author_name: string;
  author_email?: string | null;
  locale?: string | null;
  /** Public URLs returned by POST /store/product-review-photos. */
  photo_urls?: string[] | null;
}

/**
 * What the validate step hands to the create step: the same review with every
 * field normalised, and `photo_urls` already serialised to the JSON string the
 * column stores. Kept separate from the input type so the two cannot be mixed
 * up — they differ in exactly that field.
 */
interface ValidatedProductReview {
  product_handle: string;
  rating: number;
  body: string;
  author_name: string;
  author_email: string | null;
  locale: string;
  photo_urls: string | null;
}

/** Hard caps so a single POST can't write an unbounded row. */
const MAX_BODY_CHARS = 2000;
const MAX_NAME_CHARS = 80;
const MAX_PHOTOS = 3;

/**
 * Validation lives here rather than in the route: the route is an HTTP adapter,
 * and these are rules about what a review *is*. Anything reaching the module
 * service has already passed them.
 */
const validateReviewStep = createStep(
  "validate-product-review",
  async (input: CreateProductReviewInput) => {
    const handle = String(input.product_handle || "").trim();
    if (!handle) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A product handle is required.");
    }

    // Number(), not parseInt(): "4abc" must be rejected, not silently read as 4.
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Rating must be a whole number between 1 and 5."
      );
    }

    const body = String(input.body || "").trim();
    if (!body) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A review body is required.");
    }

    const authorName = String(input.author_name || "").trim();
    if (!authorName) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A display name is required.");
    }

    const email = input.author_email ? String(input.author_email).trim().toLowerCase() : null;

    // Only URLs our own upload route produced are stored. Without this check a
    // review body could point at any address on the internet and the product
    // page would dutifully render it — an open image-embed hole.
    const photos = (Array.isArray(input.photo_urls) ? input.photo_urls : [])
      .map((url) => String(url || "").trim())
      .filter((url) => /^https?:\/\//i.test(url))
      .slice(0, MAX_PHOTOS);

    return new StepResponse<ValidatedProductReview>({
      product_handle: handle,
      rating,
      body: body.slice(0, MAX_BODY_CHARS),
      author_name: authorName.slice(0, MAX_NAME_CHARS),
      author_email: email || null,
      locale: input.locale === "en" ? "en" : "es",
      photo_urls: photos.length ? JSON.stringify(photos) : null,
    });
  }
);

/**
 * Persists the review. The compensation deletes it, so a failure later in the
 * workflow cannot leave a half-written review visible on the product page.
 */
const createReviewStep = createStep(
  "create-product-review",
  async (input: ValidatedProductReview, { container }) => {
    const service = container.resolve<ProductReviewModuleService>(PRODUCT_REVIEW_MODULE);
    const review = await service.createProductReviews(input);
    return new StepResponse(review, review.id);
  },
  async (reviewId, { container }) => {
    if (!reviewId) return;
    const service = container.resolve<ProductReviewModuleService>(PRODUCT_REVIEW_MODULE);
    await service.deleteProductReviews(reviewId);
  }
);

export const createProductReviewWorkflow = createWorkflow(
  "create-product-review",
  function (input: CreateProductReviewInput) {
    const validated = validateReviewStep(input);
    const review = createReviewStep(validated);
    return new WorkflowResponse(review);
  }
);

export default createProductReviewWorkflow;
