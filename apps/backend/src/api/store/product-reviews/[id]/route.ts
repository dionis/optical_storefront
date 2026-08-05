import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRODUCT_REVIEW_MODULE } from "../../../../modules/product-review/index";
import type ProductReviewModuleService from "../../../../modules/product-review/service";
import { verifyReviewToken } from "../../../../lib/review-access";

/**
 * A shopper's own review: read it back, edit it, or take it down.
 *
 * Authorship is proved by the edit token minted at creation (see
 * lib/review-access.ts), never by the email on the record — that field is
 * client-supplied and would authorise anyone who guessed an address.
 */

const MAX_BODY_CHARS = 2000;

function toPublic(review: Record<string, unknown>) {
  let photos: string[] = [];
  try {
    const parsed = JSON.parse(String(review.photo_urls ?? "[]"));
    if (Array.isArray(parsed)) photos = parsed.filter((u) => typeof u === "string");
  } catch {
    photos = [];
  }
  return {
    id: String(review.id),
    product_handle: String(review.product_handle),
    rating: Number(review.rating),
    body: String(review.body),
    author_name: String(review.author_name),
    created_at: new Date(review.created_at as string).toISOString(),
    photo_urls: photos,
  };
}

/** GET /store/product-reviews/:id — one review, for the author's own list. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const service = req.scope.resolve<ProductReviewModuleService>(PRODUCT_REVIEW_MODULE);
  try {
    const review = await service.retrieveProductReview(req.params.id);
    res.json({ review: toPublic(review as unknown as Record<string, unknown>) });
  } catch {
    res.status(404).json({ error_code: "not_found", error: "Review not found." });
  }
}

interface UpdateBody {
  token?: string;
  rating?: number | string;
  body?: string;
}

/**
 * POST /store/product-reviews/:id — edit.
 *
 * POST rather than PUT/PATCH: this backend only exposes GET, POST and DELETE.
 */
export async function POST(
  req: MedusaRequest<UpdateBody>,
  res: MedusaResponse
): Promise<void> {
  const id = req.params.id;
  const body = (req.body ?? {}) as UpdateBody;

  if (!verifyReviewToken(body.token, id)) {
    res.status(403).json({ error_code: "not_author", error: "This review cannot be edited from here." });
    return;
  }

  const patch: Record<string, unknown> = { id };

  if (body.rating !== undefined) {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error_code: "invalid_rating", error: "Rating must be a whole number between 1 and 5." });
      return;
    }
    patch.rating = rating;
  }

  if (body.body !== undefined) {
    const text = String(body.body).trim();
    if (!text) {
      res.status(400).json({ error_code: "invalid_body", error: "A review body is required." });
      return;
    }
    patch.body = text.slice(0, MAX_BODY_CHARS);
  }

  const service = req.scope.resolve<ProductReviewModuleService>(PRODUCT_REVIEW_MODULE);
  try {
    const updated = await service.updateProductReviews(patch);
    const review = Array.isArray(updated) ? updated[0] : updated;
    res.json({ review: toPublic(review as unknown as Record<string, unknown>) });
  } catch {
    res.status(404).json({ error_code: "not_found", error: "Review not found." });
  }
}

/**
 * DELETE /store/product-reviews/:id — take it down.
 *
 * The token rides in a header: a DELETE body is legal but widely dropped by
 * proxies, and losing it here would read as "not the author".
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = req.params.id;
  const token = req.headers["x-review-token"];

  if (!verifyReviewToken(Array.isArray(token) ? token[0] : token, id)) {
    res.status(403).json({ error_code: "not_author", error: "This review cannot be deleted from here." });
    return;
  }

  const service = req.scope.resolve<ProductReviewModuleService>(PRODUCT_REVIEW_MODULE);
  // Soft delete: the row stays for moderation history, but every read filters
  // `deleted_at IS NULL`, so it leaves the product page immediately.
  await service.softDeleteProductReviews(id);
  res.status(200).json({ id, deleted: true });
}
