import { model } from "@medusajs/framework/utils";

/**
 * A customer review of a catalogue frame.
 *
 * Reviews used to live in the browser's localStorage, which meant they were not
 * really reviews at all: nobody but their author could ever see one, and they
 * vanished with the cache. This table is the actual store of record.
 *
 * `product_handle` rather than a module link on purpose. The storefront routes
 * by scraped slug (`/producto/:slug`, `/recetas/:slug`), the catalogue is
 * re-ingested wholesale by the scraper — which can reissue product ids — and a
 * review has to survive that. The handle is the identifier that is stable across
 * a re-scrape, so it is the one worth keying on.
 */
export const ProductReview = model.define("product_review", {
  id: model.id().primaryKey(),
  /** Catalogue slug/handle of the reviewed frame, e.g. "dc406". */
  product_handle: model.text().index("IDX_product_review_handle"),
  /** 1–5 stars. Range is enforced in the workflow, before this is written. */
  rating: model.number(),
  /** The review body. */
  body: model.text(),
  /**
   * Display name the reviewer chose. Not an identity claim — checkout is guest
   * and anyone may post — so it is treated as free text, never as an account.
   */
  author_name: model.text(),
  /**
   * Reviewer's email when they were signed in. Kept so a review can be traced
   * back or removed on request, never rendered to other shoppers.
   */
  author_email: model.text().nullable(),
  /**
   * Locale the review was written in ("es" / "en"), so the storefront can note
   * when a review is not in the reader's language rather than silently mixing
   * them. Not translated: putting words in a customer's mouth is not ours to do.
   */
  locale: model.text().nullable(),
  /**
   * Photos the reviewer attached, as a JSON array of public URLs.
   *
   * The images themselves live in the public assets bucket (uploaded through
   * the file module by POST /store/product-review-photos) — not here. The old
   * localStorage version inlined base64 data URIs, which is exactly what must
   * not end up in a database column.
   *
   * One text column rather than a child table: it is a short list, written once
   * with its review and always read whole, so a join would buy nothing.
   */
  photo_urls: model.text().nullable(),
});
