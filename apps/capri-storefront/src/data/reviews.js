// Product reviews, served by the backend.
//
// These used to live in localStorage under `oer_rev_<slug>`, which meant a
// review was only ever visible to the person who wrote it and disappeared when
// the browser cleared its storage. Everything here talks to
// /store/product-reviews instead, so a review written on a phone is the same
// review everyone else reads.
//
// The star rating and review count on cards and the PDP now come from these
// records too. They used to be numbers the scraper invented (filler.py); a
// rating that a customer weighs a purchase against has to be real.
import { medusa } from "./medusa.js";
import { rememberReview } from "../components/reviewsStore.js";

/**
 * Summaries for many frames in one request, keyed by handle.
 *
 * The catalogue renders hundreds of cards, so per-card requests are not an
 * option. Handles with no reviews are absent from the result — callers must
 * render "no rating yet", never a zero.
 */
const summaryCache = new Map();

/** In-flight batches, so a re-render mid-fetch doesn't re-request the same handles. */
let pending = null;

export async function fetchReviewSummaries(handles) {
  const wanted = [...new Set((handles || []).filter(Boolean))];
  const missing = wanted.filter((h) => !summaryCache.has(h));

  // The endpoint caps how many handles one request may carry, so ask in
  // chunks. Sorting the whole catalogue by rating needs every handle, not just
  // the ones currently on screen.
  const CHUNK = 100;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    try {
      const res = await medusa.client.fetch(
        `/store/product-reviews/summary?handles=${encodeURIComponent(chunk.join(","))}`
      );
      const summaries = res?.summaries || {};
      // Cache the misses too (as null), or every render re-asks for the frames
      // that simply have no reviews — which is most of the catalogue.
      for (const handle of chunk) summaryCache.set(handle, summaries[handle] || null);
    } catch {
      // A failed summary must not blank the catalogue: leave this chunk
      // uncached so a later render can retry, and keep what we already know.
    }
  }

  const out = {};
  for (const handle of wanted) {
    const summary = summaryCache.get(handle);
    if (summary) out[handle] = summary;
  }
  return out;
}

/** Full review list for one frame, newest first, plus its aggregate. */
export async function fetchReviews(handle, { limit = 20, offset = 0 } = {}) {
  if (!handle) return { reviews: [], count: 0, average: null };
  const qs = new URLSearchParams({ handle, limit: String(limit), offset: String(offset) });
  const res = await medusa.client.fetch(`/store/product-reviews?${qs.toString()}`);
  return {
    reviews: res?.reviews || [],
    count: res?.count || 0,
    average: res?.average ?? null,
  };
}

/**
 * Upload review photos and return their public URLs.
 *
 * Deliberately a separate call from creating the review: if the images fail,
 * the customer keeps the words they typed and can post without them.
 */
export async function uploadReviewPhotos(files) {
  const list = Array.from(files || []).slice(0, 3);
  if (!list.length) return [];
  const form = new FormData();
  for (const file of list) form.append("files", file);
  const res = await medusa.client.fetch("/store/product-review-photos", {
    method: "POST",
    body: form,
    // Same reason as the prescription upload: let the browser set the
    // multipart boundary instead of the SDK's JSON content-type.
    headers: { "content-type": null },
  });
  return res?.urls || [];
}

/** Publish a review. Resolves with the stored record as other shoppers see it. */
export async function createReview({ handle, rating, body, authorName, authorEmail, locale, photoUrls }) {
  const res = await medusa.client.fetch("/store/product-reviews", {
    method: "POST",
    body: {
      product_handle: handle,
      rating,
      body,
      author_name: authorName,
      author_email: authorEmail || null,
      locale: locale || null,
      photo_urls: photoUrls && photoUrls.length ? photoUrls : null,
    },
  });
  // A new review changes the aggregate, so the cached summary is now wrong.
  summaryCache.delete(handle);
  // The edit token is returned exactly once; keeping it is what lets "my
  // account" offer edit/delete later.
  if (res?.review && res?.edit_token) {
    rememberReview({ id: res.review.id, handle, token: res.edit_token });
  }
  return res?.review || null;
}

/** Drops cached summaries — used after a write that invalidates several. */
export function clearReviewSummaryCache() {
  summaryCache.clear();
}
