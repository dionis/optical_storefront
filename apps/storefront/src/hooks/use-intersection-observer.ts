"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * Calls `callback` once whenever `ref.current` enters the viewport.
 * Used for infinite-scroll load-more triggers.
 */
export function useIntersectionObserver(
  callback: () => void,
  options: IntersectionObserverInit = { rootMargin: "200px" }
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const stableCallback = useCallback(callback, [callback]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        stableCallback();
      }
    }, options);

    observer.observe(el);
    return () => observer.disconnect();
  }, [stableCallback, options]);

  return ref;
}
