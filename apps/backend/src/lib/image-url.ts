/**
 * ONE place that turns a stored image reference into a URL the panel can load
 * (docs/PRICE-MATRIX.md, v2 — «miniaturas rotas»).
 *
 * The catalogue holds BARE storage keys ("products/dc407-di-caprio/…_00.webp")
 * — `product.thumbnail`, `images[].url`, `variant.metadata.image` as the
 * scraper writes them — because the bucket's public origin is deployment
 * config, not catalogue data. Anything scraped before the bucket migration is
 * still an absolute supplier URL. The storefront prefixes keys itself
 * (`resolveImage`, apps/capri-storefront/src/data/imageUrl.js); the panel
 * rendered the key as a relative path and showed an empty box. So every route
 * of ours that hands the panel a product image returns it through here:
 *
 *   http(s)://…, data:…, //…   left exactly as they are
 *   /brands/logo-di-caprio.png a path on the panel's own origin (brand logos,
 *                              served by the storefront): left alone, the
 *                              frontend prefixes nothing
 *   products/…/x.webp          `<public base>/products/…/x.webp`
 *
 * Public base: `R2_PUBLIC_URL`, else `VITE_R2_PUBLIC_URL` (the storefront's
 * name for it), else the shop's bucket — where every photo lives today — the
 * same default the order e-mails use (lib/email/order-enrich.ts). A value of
 * the `.env.example` placeholder (example.com) counts as unset.
 */

export const DEFAULT_ASSET_BASE = "https://svuuuobjgrkscsjgpwkx.supabase.co/storage/v1/object/public/eyewear-assets";

/** The public origin keys are served from, without a trailing slash. */
export function publicAssetBase(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.R2_PUBLIC_URL || env.VITE_R2_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  return raw && !/example\.com/i.test(raw) ? raw : DEFAULT_ASSET_BASE;
}

/** True for a value that is already a URL a browser loads as is. */
const isAbsolute = (v: string): boolean => /^(?:https?:|data:|blob:)/i.test(v) || v.startsWith("//");

/**
 * The URL of a stored image reference; null for nothing. Pure given `base`
 * (defaults to `publicAssetBase()`).
 */
export function absoluteImageUrl(value: unknown, base: string = publicAssetBase()): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  if (isAbsolute(v) || v.startsWith("/")) return v;
  return `${base.replace(/\/+$/, "")}/${v}`;
}

/** The same over a list, dropping empties and duplicates (order kept). Pure. */
export function absoluteImageUrls(values: ReadonlyArray<unknown>, base: string = publicAssetBase()): string[] {
  const out: string[] = [];
  for (const v of values) {
    const url = absoluteImageUrl(v, base);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Folder of the catalogue uploads (`POST /admin/catalog/uploads`) in the public bucket. */
export const CATALOG_UPLOAD_PREFIX = "catalog";

/** A storage key for an upload: `catalog/<timestamp>-<safe name>`. Pure. */
export function catalogUploadKey(originalName: string, now = Date.now()): string {
  const safe =
    String(originalName || "image")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-80) || "image";
  return `${CATALOG_UPLOAD_PREFIX}/${now}-${safe}`;
}
