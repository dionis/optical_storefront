// The shopper's own reviews.
//
// Reviews themselves live in the backend now (see src/data/reviews.js). What
// stays in localStorage is only the edit token the API hands back when a review
// is created — it is the sole proof that this browser wrote it, since checkout
// is guest and there is no account to hang authorship on.
//
// Deliberately NOT keyed by email: listing "reviews written by this address"
// without proving control of the address would let anyone enumerate, edit and
// delete someone else's reviews by typing their email. Holding the token is the
// proof. The cost is that clearing site data loses the ability to edit, which is
// the right trade for an anonymous review.
import { medusa } from "../data/medusa.js";

const KEY = "oer_review_tokens";

const subs = new Set();
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
function bump() { for (const f of subs) f(); }

/** [{ id, handle, token }] */
function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
  bump();
}

/** Remember a review this browser just published. */
export function rememberReview({ id, handle, token }) {
  if (!id || !token) return;
  write([{ id, handle, token }, ...read().filter((r) => r.id !== id)]);
}

export function tokenFor(id) {
  return read().find((r) => r.id === id)?.token || null;
}

export function forgetReview(id) {
  write(read().filter((r) => r.id !== id));
}

/**
 * The reviews this browser can edit, fetched fresh from the backend.
 *
 * Anything the server no longer has (deleted elsewhere, or purged) is dropped
 * from local storage as we go, so the list can't accumulate dead tokens.
 */
export async function listOwnReviews() {
  const stored = read();
  if (!stored.length) return [];

  const results = await Promise.all(
    stored.map(async (entry) => {
      try {
        const res = await medusa.client.fetch(`/store/product-reviews/${entry.id}`);
        return res?.review ? { ...res.review, token: entry.token } : null;
      } catch {
        return null;
      }
    })
  );

  const alive = results.filter(Boolean);
  if (alive.length !== stored.length) {
    const keep = new Set(alive.map((r) => r.id));
    write(stored.filter((entry) => keep.has(entry.id)));
  }
  return alive.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/** Edit one of this browser's reviews. */
export async function updateOwnReview(id, patch) {
  const token = tokenFor(id);
  if (!token) throw new Error("No edit token for this review.");
  const res = await medusa.client.fetch(`/store/product-reviews/${id}`, {
    method: "POST",
    body: { token, ...patch },
  });
  bump();
  return res?.review || null;
}

/** Take one of this browser's reviews down. */
export async function removeOwnReview(id) {
  const token = tokenFor(id);
  if (!token) throw new Error("No edit token for this review.");
  await medusa.client.fetch(`/store/product-reviews/${id}`, {
    method: "DELETE",
    // Sent as a header, not a body: DELETE bodies are legal but commonly
    // stripped by proxies, and losing it would read as "not the author".
    headers: { "x-review-token": token },
  });
  forgetReview(id);
}
