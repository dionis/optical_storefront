// One place that turns a stored image reference into something an <img> can load.
//
// The catalog and the order history both hold BARE R2 keys
// ("products/dc407-di-caprio/dc407-di-caprio_00.webp") — never absolute URLs —
// because the bucket's public origin is deployment config, not catalog data.
// Anything scraped before the R2 migration is still an absolute supplier URL, so
// both shapes have to survive.
//
// Rendering the raw key gives a relative path against the storefront origin,
// which 404s into an empty grey box rather than failing loudly. That is exactly
// how the order list ended up with placeholder squares where the frames should
// be, so any new surface showing product imagery must go through here.

const R2_PUBLIC =
  import.meta.env && import.meta.env.VITE_R2_PUBLIC_URL
    ? String(import.meta.env.VITE_R2_PUBLIC_URL).replace(/\/$/, "")
    : "";

export function resolveImage(key) {
  if (!key) return "";
  if (/^https?:\/\//i.test(key)) return key;
  return R2_PUBLIC ? `${R2_PUBLIC}/${key.replace(/^\//, "")}` : key;
}
