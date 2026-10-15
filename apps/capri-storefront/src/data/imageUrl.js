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

/**
 * Misma URL, pero pidiéndole al almacén una versión REDIMENSIONADA.
 *
 * El bucket (Supabase Storage) sabe servir derivadas por su endpoint
 * `/render/image/`: se le pide un ancho y devuelve WebP al navegador que lo
 * acepta. La diferencia no es pequeña — una foto de montura pasa de ~35 KB
 * (original) a ~10 KB a 560 px y ~5 KB a 320 px. En una rejilla de catálogo con
 * 48 tarjetas eso es más de 1 MB menos por pantalla.
 *
 * Devuelve la URL SIN TOCAR cuando no se pide ancho o cuando el origen no es el
 * bucket (quedan URLs absolutas antiguas del proveedor, que no saben de esto),
 * así que llamar a esto nunca puede romper una imagen que hoy carga: en el peor
 * caso se comporta exactamente como `resolveImage`.
 */
export function resolveImageSized(key, width, quality = 75) {
  const url = resolveImage(key);
  if (!url || !width) return url;
  // Solo el endpoint de objetos del bucket tiene equivalente de render.
  if (!url.includes("/storage/v1/object/public/")) return url;
  const base = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}width=${Math.round(width)}&quality=${quality}`;
}

/**
 * `srcset` listo para usar: el navegador elige el ancho según el tamaño real en
 * pantalla y la densidad del dispositivo, así que una pantalla normal baja la
 * versión pequeña y solo una retina pide la grande. Vacío (cadena nula) cuando
 * la URL no admite redimensionado — y un `srcSet=""` hace que el navegador use
 * `src` sin más, que es justo el comportamiento de hoy.
 */
export function imageSrcSet(key, widths = [320, 480, 640], quality = 75) {
  const url = resolveImage(key);
  if (!url || !url.includes("/storage/v1/object/public/")) return "";
  return widths.map((w) => `${resolveImageSized(key, w, quality)} ${w}w`).join(", ");
}

/**
 * Same key→URL resolution as images, named apart so a video call does not read as
 * a lie. An R2 key is an R2 key whatever is inside it, and duplicating the logic
 * is how the two end up disagreeing about an empty VITE_R2_PUBLIC_URL.
 */
export const resolveMedia = resolveImage;
