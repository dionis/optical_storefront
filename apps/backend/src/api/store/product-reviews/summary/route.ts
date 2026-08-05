import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRODUCT_REVIEW_MODULE } from "../../../../modules/product-review/index";
import type ProductReviewModuleService from "../../../../modules/product-review/service";

/**
 * How many handles one request may ask about. A catalogue page shows a few
 * dozen cards; this is comfortably above that and still bounds the query.
 */
const MAX_HANDLES = 120;

export interface ReviewSummary {
  average: number;
  count: number;
}

/**
 * GET /store/product-reviews/summary?handles=dc406,dc407 — rating and count for
 * many frames at once.
 *
 * The catalogue renders hundreds of cards; asking per card would be hundreds of
 * requests, which is why the storefront used to just print the scraper's
 * invented rating instead. One batched call makes real ratings affordable.
 *
 * Handles with no reviews are simply absent from the response — the storefront
 * shows no rating at all for those, rather than a misleading zero.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const raw = String(req.query.handles ?? "").trim();
  if (!raw) {
    res.json({ summaries: {} });
    return;
  }

  const handles = [
    ...new Set(
      raw
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
    ),
  ].slice(0, MAX_HANDLES);

  if (!handles.length) {
    res.json({ summaries: {} });
    return;
  }

  const service = req.scope.resolve<ProductReviewModuleService>(PRODUCT_REVIEW_MODULE);
  const rows = (await service.listProductReviews(
    { product_handle: handles },
    { select: ["product_handle", "rating"] }
  )) as Array<{ product_handle: string; rating: number }>;

  const totals = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const entry = totals.get(row.product_handle) ?? { sum: 0, count: 0 };
    entry.sum += Number(row.rating || 0);
    entry.count += 1;
    totals.set(row.product_handle, entry);
  }

  const summaries: Record<string, ReviewSummary> = {};
  for (const [handle, { sum, count }] of totals) {
    summaries[handle] = { average: Math.round((sum / count) * 10) / 10, count };
  }

  res.json({ summaries });
}
