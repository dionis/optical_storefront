import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchReviewSummaries } from "../data/reviews.js";

// Batches the rating lookups for every product card on screen into one request.
//
// A catalogue page renders dozens of cards and the home page several rails; one
// request per card would be hundreds of round trips, which is the practical
// reason the storefront used to just print the scraper's invented rating. Cards
// register the handle they need, this collects them for a tick, and a single
// /store/product-reviews/summary call answers all of them.

const ReviewSummaryContext = createContext(null);

export function ReviewSummaryProvider({ children }) {
  const [summaries, setSummaries] = useState({});
  // Handles registered since the last flush, and the pending flush timer.
  const queue = useRef(new Set());
  const timer = useRef(null);
  const known = useRef(new Set());

  const flush = useCallback(async () => {
    timer.current = null;
    const handles = [...queue.current];
    queue.current.clear();
    if (!handles.length) return;
    try {
      const found = await fetchReviewSummaries(handles);
      // Merge rather than replace: a later page's results must not drop an
      // earlier one's while both are mounted.
      setSummaries((prev) => ({ ...prev, ...found }));
    } catch {
      // Red caída: saca los handles de `known` para que el próximo render
      // pueda REINTENTAR de verdad (antes quedaban marcados como resueltos y
      // el catálogo se pasaba toda la sesión sin estrellas).
      for (const h of handles) known.current.delete(h);
    }
  }, []);

  const request = useCallback((handle) => {
    if (!handle || known.current.has(handle)) return;
    known.current.add(handle);
    queue.current.add(handle);
    // A microtask is too early — cards mount across several render passes — and
    // a long delay shows a visible pop-in. One frame is the balance.
    if (timer.current == null) timer.current = setTimeout(flush, 16);
  }, [flush]);

  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current); }, []);

  // Memoizado: cada flush creaba un value nuevo y re-renderizaba TODAS las
  // tarjetas suscritas aunque sus resúmenes no cambiaran.
  const value = useMemo(() => ({ summaries, request }), [summaries, request]);

  return (
    <ReviewSummaryContext.Provider value={value}>
      {children}
    </ReviewSummaryContext.Provider>
  );
}

/**
 * The rating for one frame, or null when nobody has reviewed it — which the
 * caller must render as "no rating", never as a zero.
 */
export function useReviewSummary(handle) {
  const ctx = useContext(ReviewSummaryContext);
  useEffect(() => { ctx?.request(handle); }, [ctx, handle]);
  return ctx?.summaries[handle] || null;
}

export default ReviewSummaryContext;
