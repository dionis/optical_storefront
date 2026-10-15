// Versioned localStorage, purged automatically.
//
// Every `oer_*` key is a small cache written by a past version of this app. When
// a deploy changes the shape of one of them, the old value doesn't disappear —
// it sits there being misread, and the only cure was asking the customer to
// clear their browser data. Bumping STORAGE_VERSION drops the disposable keys on
// the next load instead, with nobody deciding anything.
//
// Bump STORAGE_VERSION when you change the shape of anything stored under an
// `oer_` key that is NOT in DURABLE below.

const VERSION_KEY = "oer_storage_version";
const STORAGE_VERSION = "1";
const PREFIX = "oer_";

/**
 * Keys that survive a version bump, because losing them costs the customer
 * something real rather than just a refetch:
 *
 *   oer_pending_order — payment confirmed, order not created yet. Dropping this
 *                       strands a charge with no way back to it. Never purge.
 *   oer_medusa_cart   — the id of a server-side cart. The cart is revalidated
 *                       against today's catalog anyway, so a stale id is not a
 *                       stale price.
 *   oer_order_access  — 90-day guest session for order tracking; purging it
 *                       forces another magic-link email.
 *   oer_review_tokens — proves authorship of a review the customer wrote.
 *   oer_fav, oer_lang, oer_user, oer_sfx_muted — the customer's own choices.
 *
 * Everything else (analytics counters, seeded demo data, review summaries, the
 * admin's local price overrides) is a cache and can be rebuilt.
 */
const DURABLE = new Set([
  VERSION_KEY,
  "oer_pending_order",
  "oer_medusa_cart",
  "oer_order_access",
  "oer_review_tokens",
  "oer_fav",
  "oer_lang",
  "oer_user",
  "oer_sfx_muted",
]);

/**
 * Drop stale `oer_*` caches when the storage version has moved. Call once, as
 * early as possible — before any module reads what it might be about to purge.
 *
 * Returns the number of keys removed (0 on the common path, and on any browser
 * where localStorage throws — a private-mode failure must never block boot).
 */
export function purgeStaleStorage() {
  try {
    if (localStorage.getItem(VERSION_KEY) === STORAGE_VERSION) return 0;

    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX) && !DURABLE.has(key)) doomed.push(key);
    }
    // Collect first, then delete: removing during the scan shifts the indices
    // and silently skips every other key.
    for (const key of doomed) localStorage.removeItem(key);

    localStorage.setItem(VERSION_KEY, STORAGE_VERSION);
    return doomed.length;
  } catch {
    return 0;
  }
}
