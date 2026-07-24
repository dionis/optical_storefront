// Reviews live in localStorage as oer_rev_<slug> = [{ id, user, product, rating, text, date, name }].
// This module lets the "Mi cuenta" area list a customer's own reviews and edit/delete them.
const PREFIX = "oer_rev_";

const rd = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const subs = new Set();
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
function bump() { for (const f of subs) f(); }

export function listByUser(email) {
  if (!email) return [];
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const slug = key.slice(PREFIX.length);
    for (const r of rd(key)) if (r && r.user === email) out.push({ ...r, slug });
  }
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export function updateReview(slug, id, patch) {
  const key = PREFIX + slug;
  wr(key, rd(key).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  bump();
}
export function removeReview(slug, id) {
  const key = PREFIX + slug;
  wr(key, rd(key).filter((r) => r.id !== id));
  bump();
}
