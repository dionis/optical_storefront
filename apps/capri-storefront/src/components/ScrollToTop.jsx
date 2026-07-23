import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// On every route change (clicking a product, brand, nav link, breadcrumb, logo…)
// jump back to the top of the page instead of keeping the previous scroll position.
export default function ScrollToTop() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, search]);
  return null;
}
