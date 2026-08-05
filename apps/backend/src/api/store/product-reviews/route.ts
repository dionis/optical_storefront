import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { createProductReviewWorkflow } from "../../../workflows/create-product-review";
import { PRODUCT_REVIEW_MODULE } from "../../../modules/product-review/index";
import type ProductReviewModuleService from "../../../modules/product-review/service";
import { issueReviewToken } from "../../../lib/review-access";

/** Page size cap, so a handle with many reviews can't be used to pull the table. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

interface PublicReview {
  id: string;
  rating: number;
  body: string;
  author_name: string;
  locale: string | null;
  created_at: string;
  photo_urls: string[];
}

/** Stored as a JSON array; a malformed value must not break the product page. */
function parsePhotoUrls(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Strips everything that is not for other shoppers to see. `author_email` in
 * particular is stored for traceability and must never leave the backend —
 * publishing reviewer addresses on a product page would be a leak, not a
 * feature.
 */
function toPublic(review: Record<string, unknown>): PublicReview {
  return {
    id: String(review.id),
    rating: Number(review.rating),
    body: String(review.body),
    author_name: String(review.author_name),
    locale: review.locale == null ? null : String(review.locale),
    created_at: new Date(review.created_at as string).toISOString(),
    photo_urls: parsePhotoUrls(review.photo_urls),
  };
}

/**
 * GET /store/product-reviews?handle=dc406 — reviews for one frame, newest first,
 * plus the aggregate the product card and PDP show.
 *
 * The average is computed here, from stored reviews only. It used to be a
 * number invented by the scraper's filler; a rating that influences a purchase
 * has to come from actual customers.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const handle = String(req.query.handle ?? "").trim();
  if (!handle) {
    res.status(400).json({ error_code: "handle_required", error: "A `handle` query parameter is required." });
    return;
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const service = req.scope.resolve<ProductReviewModuleService>(PRODUCT_REVIEW_MODULE);

  // Two reads on purpose: the page is a window, but the average has to be over
  // every review, not just the ones on screen.
  const [page, count] = await service.listAndCountProductReviews(
    { product_handle: handle },
    { take: limit, skip: offset, order: { created_at: "DESC" } }
  );
  const all = (await service.listProductReviews(
    { product_handle: handle },
    { select: ["rating"] }
  )) as Array<{ rating: number }>;

  const sum = all.reduce((total, r) => total + Number(r.rating || 0), 0);
  // Rounded to one decimal for display; null when there is nothing to average,
  // which the storefront renders as "be the first to review" rather than 0.
  const average = all.length ? Math.round((sum / all.length) * 10) / 10 : null;

  res.json({
    reviews: (page as Array<Record<string, unknown>>).map(toPublic),
    count,
    average,
    limit,
    offset,
  });
}

interface CreateBody {
  handle?: string;
  product_handle?: string;
  rating?: number | string;
  body?: string;
  author_name?: string;
  name?: string;
  author_email?: string | null;
  locale?: string | null;
  photo_urls?: string[] | null;
}

/**
 * POST /store/product-reviews — publish a review.
 *
 * Open to anyone, published immediately: that is the product decision for this
 * store. The workflow enforces the shape and the length caps; nothing here
 * trusts the client beyond that.
 */
export async function POST(
  req: MedusaRequest<CreateBody>,
  res: MedusaResponse
): Promise<void> {
  const body = (req.body ?? {}) as CreateBody;

  const { result } = await createProductReviewWorkflow(req.scope).run({
    input: {
      product_handle: String(body.product_handle ?? body.handle ?? ""),
      rating: Number(body.rating),
      body: String(body.body ?? ""),
      author_name: String(body.author_name ?? body.name ?? ""),
      author_email: body.author_email ?? null,
      locale: body.locale ?? null,
      photo_urls: body.photo_urls ?? null,
    },
  });

  const review = toPublic(result as unknown as Record<string, unknown>);
  // The token is the ONLY proof of authorship the shopper will ever have — the
  // browser keeps it so "my reviews" can offer edit and delete. It is returned
  // exactly once, here, and never appears in any read of the review.
  res.status(201).json({ review, edit_token: issueReviewToken(review.id) });
}
