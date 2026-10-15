// SEO por página (pedido del dueño): la app es una SPA, así que el <head> se
// actualiza desde JS al navegar — Google ejecuta JS y lee esto. Cada página
// llama a setSeo() con su título, descripción, imagen y (en las fichas) el
// JSON-LD de Producto; al salir no hace falta limpiar porque la siguiente
// página escribe lo suyo encima. Base estática (idioma, OG por defecto,
// favicon, preconnects) vive en index.html.
const ensure = (selector, create) => {
  let el = document.head.querySelector(selector);
  if (!el) { el = create(); document.head.appendChild(el); }
  return el;
};

const meta = (attr, name, content) => {
  if (content == null) return;
  const el = ensure(`meta[${attr}="${name}"]`, () => {
    const m = document.createElement("meta");
    m.setAttribute(attr, name);
    return m;
  });
  el.setAttribute("content", content);
};

/**
 * Escribe título, descripción, canónica, Open Graph/Twitter y (opcional) el
 * JSON-LD de la página. `path` es la ruta canónica ("/producto/dc406"); la
 * imagen puede ser relativa o absoluta.
 */
export function setSeo({ title, description, path, image, type = "website", jsonLd = null }) {
  const origin = window.location.origin;
  const url = path ? origin + path : window.location.href.split("?")[0];
  const img = image ? (/^https?:/i.test(image) ? image : origin + image) : origin + "/og-image.jpg";

  if (title) document.title = title;
  meta("name", "description", description);
  meta("property", "og:title", title);
  meta("property", "og:description", description);
  meta("property", "og:url", url);
  meta("property", "og:image", img);
  meta("property", "og:type", type);
  meta("name", "twitter:title", title);
  meta("name", "twitter:description", description);
  meta("name", "twitter:image", img);

  const canon = ensure('link[rel="canonical"]', () => {
    const l = document.createElement("link");
    l.setAttribute("rel", "canonical");
    return l;
  });
  canon.setAttribute("href", url);

  let ld = document.getElementById("seo-jsonld");
  if (jsonLd) {
    if (!ld) {
      ld = document.createElement("script");
      ld.id = "seo-jsonld";
      ld.type = "application/ld+json";
      document.head.appendChild(ld);
    }
    ld.textContent = JSON.stringify(jsonLd);
  } else if (ld) {
    ld.remove();
  }
}

/** JSON-LD de Producto para la ficha del espejuelo (precio, marca, foto). */
export function productJsonLd({ name, brand, description, image, path, price, currency = "USD", inStock = true }) {
  const origin = window.location.origin;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    brand: brand ? { "@type": "Brand", name: brand } : undefined,
    description,
    image: image ? [/^https?:/i.test(image) ? image : origin + image] : undefined,
    url: origin + path,
    offers: {
      "@type": "Offer",
      url: origin + path,
      priceCurrency: currency,
      price: typeof price === "number" ? price.toFixed(2) : String(price || ""),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
}

/** Preconexiones en caliente a los hosts reales (backend e imágenes R2): el
 *  navegador abre TLS antes de la primera petición y el catálogo pinta antes. */
export function initPerfHints() {
  const hosts = new Set();
  try {
    const api = import.meta.env && import.meta.env.VITE_MEDUSA_URL;
    if (api) hosts.add(new URL(api).origin);
  } catch { /* nada */ }
  try {
    const r2 = import.meta.env && import.meta.env.VITE_R2_PUBLIC_URL;
    if (r2) hosts.add(new URL(r2).origin);
  } catch { /* nada */ }
  for (const origin of hosts) {
    if (document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) continue;
    const l = document.createElement("link");
    l.rel = "preconnect";
    l.href = origin;
    l.crossOrigin = "anonymous";
    document.head.appendChild(l);
    const d = document.createElement("link");
    d.rel = "dns-prefetch";
    d.href = origin;
    document.head.appendChild(d);
  }
}
