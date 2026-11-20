// Medusa Store API → storefront catalog adapter (Phase 1).
//
// When VITE_USE_MEDUSA=true, catalogStore.loadLive() pulls the catalog from the
// Medusa Store API instead of the static public/*.json. This module fetches every
// published product for the sales channel (paginated) and maps each one to the
// exact shape the existing components already consume (see products.js/cases.js),
// so ProductCard / Catalog / ProductDetail need no changes.
//
// Attribute canonicalization (the "híbrido" decision): the scraper stores nominal
// values as English tokens and measurements as language-neutral buckets. Here we
// map the English tokens back to the storefront's canonical Spanish values so the
// existing filters.js + tv() (Spanish→English display) keep working unchanged.
import { medusa } from "./medusa.js";
import { hexFor } from "./products.js";
import { resolveImage, resolveMedia } from "./imageUrl.js";

// English (scraper) → canonical Spanish (storefront) for nominal attributes.
const SHAPE_ES = {
  square: "Cuadrado", round: "Redondo", "cat-eye": "Ojo de gato", navigator: "Navegador",
  rectangle: "Rectángulo", aviator: "Aviador", geometric: "Geométrico", oval: "Oval",
  "modified-oval": "Óvalo modificado", "modified-round": "Ronda modificada",
  combo: "Combo", "full-frame": "Marco completo",
};
const MATERIAL_ES = {
  acetate: "Acetato", plastic: "Plástica", metal: "Metal", "stainless-steel": "Acero inoxidable",
  memory: "Memoria", titanium: "Titanio", injection: "Inyección", tr90: "TR-90", ultem: "Ultem",
};
const GENDER_ES = { men: "Hombres", women: "Señoras", unisex: "Unisexo", kids: "Niños" };
const AGE_ES = { adult: "Adulto", kids: "Niños" };

const mapEnum = (table, v) => (v ? table[String(v).toLowerCase()] || v : v);

// Intervalos de medida del filtro (los mismos textos que `filters.js`). El
// scraper los manda ya calculados (`eye_size_bucket`…, ver
// apps/scraper/scraper/normalize.py); cuando un producto llega sin el intervalo
// pero con la medida exacta en mm (seed de QA, cargas manuales), se calcula aquí
// con los MISMOS umbrales para que los filtros de tamaño y la ficha no queden
// vacíos. Si tampoco hay medida, se deja "" como antes.
const bucketOf = (mm, steps, last) => {
  if (typeof mm !== "number" || !(mm > 0)) return "";
  for (const [max, label] of steps) if (mm <= max) return label;
  return last;
};
const EYE_STEPS = [[43, "34-43 mm"], [47, "44-47 mm"], [50, "48-50 mm"], [53, "51-53 mm"], [56, "54-56 mm"], [59, "57-59 mm"]];
const BRIDGE_STEPS = [[15, "13-15 mm"], [17, "16-17 mm"], [19, "18-19 mm"], [22, "20-22 mm"]];
const TEMPLE_STEPS = [[120, "115-120 mm"], [130, "125-130 mm"], [140, "135-140 mm"], [150, "145-150 mm"]];

// R2 keys are stored bare; hotlinked/dev images are already absolute URLs.
// Shared with the order history — see src/data/imageUrl.js.

// Lowest variant price from Medusa's server-computed calculated_price. Medusa v2
// stores amounts as decimal dollars (e.g. 99), so use them as-is — never /100.
function priceOf(product) {
  const amounts = (product.variants || [])
    .map((v) => v.calculated_price && v.calculated_price.calculated_amount)
    .filter((a) => typeof a === "number");
  if (!amounts.length) return 0;
  return Math.round(Math.min(...amounts) * 100) / 100;
}

/**
 * Generated media for one variant: the four packshots and the promo video.
 *
 * Every field is optional and stays `undefined` when absent — not `{}` or `null` —
 * so a component can write `color.views?.front` and `{color.video && …}` without
 * nested guards, and a colourway with nothing generated renders exactly as before.
 *
 * The backend stores R2 keys, so everything goes through resolveImage/resolveMedia,
 * the same funnel as every other product image.
 */
function mediaOf(v) {
  const m = (v && v.metadata) || {};

  const views = Object.fromEntries(
    Object.entries(m.views || {})
      .filter(([, key]) => key)
      .map(([slot, key]) => [slot, resolveImage(key)])
  );

  return {
    views: Object.keys(views).length ? views : undefined,
    // No poster is generated yet, so the caller falls back to the supplier photo.
    video: m.video ? { src: resolveMedia(m.video), poster: undefined } : undefined,
    model3d: m.model3d ? resolveMedia(m.model3d) : undefined,
    // Marks media a model produced rather than a camera. Carried through so the
    // page can label it if the owner ever wants that; nothing renders it today.
    mediaGenerated: m.media_generated ? true : undefined,
  };
}

function colorsOf(product) {
  const variants = product.variants || [];
  const images = (product.images || []).map((i) => i.url);
  return variants.map((v, i) => {
    const name = v.title || (v.metadata && v.metadata.color) || "Default";
    const raw = (v.metadata && v.metadata.image) || images[i] || product.thumbnail || images[0] || "";
    return {
      name,
      image: resolveImage(raw),
      hex: hexFor(name),
      variantId: v.id,
      ...mediaOf(v),
    };
  });
}

function toFrame(product) {
  const m = product.metadata || {};
  // `metadata.material` llega como string (scraper: "acetate") o como lista
  // (seed/catálogo local: ["Acetato", "Plástica"]). Antes la lista se envolvía
  // en OTRA lista (`[["Acetato","Plástica"]]`) y la ficha reventaba al hacer
  // `.toLowerCase()` sobre un array → pantalla en blanco en /producto/:slug.
  // Siempre devolvemos una lista plana de strings canónicos.
  const materials = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : [])
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => mapEnum(MATERIAL_ES, x.trim()));
  const price = priceOf(product);
  return {
    sku: product.title,
    name: product.title,
    slug: product.handle,
    brand: m.brand || "",
    brand_slug: m.brand_slug || m.collection_slug || "",
    colors: colorsOf(product),
    attributes: {
      shape: mapEnum(SHAPE_ES, m.shape) || "",
      material: materials,
      gender: mapEnum(GENDER_ES, m.gender) || "",
      age: mapEnum(AGE_ES, m.age_group) || "",
      eye_size: m.eye_size_bucket || bucketOf(m.eye_size, EYE_STEPS, "Más de 60 mm"),
      bridge_size: m.bridge_size_bucket || bucketOf(m.bridge_size, BRIDGE_STEPS, "23-24 mm"),
      temple_length: m.temple_length_bucket || bucketOf(m.temple_length, TEMPLE_STEPS, "155+ mm"),
      // Medidas exactas (mm) para la fila de especificaciones de la ficha:
      // "eye · bridge · temple" (p. ej. 55 · 18 · 145).
      eye: typeof m.eye_size === "number" ? m.eye_size : null,
      bridge: typeof m.bridge_size === "number" ? m.bridge_size : null,
      temple: typeof m.temple_length === "number" ? m.temple_length : null,
    },
    price,
    basePrice: price,
    // Precio anterior (para mostrar "$42 → $32 OFERTA"). El scraper lo guarda en
    // centavos; se divide entre 100 y solo se usa si es mayor que el precio actual
    // (así, si algún día llegara en dólares por error, simplemente no se muestra).
    originalPrice:
      typeof m.original_price_cents === "number" && m.original_price_cents > 0
        ? Math.round(m.original_price_cents) / 100
        : null,
    rating: typeof m.rating === "number" ? m.rating : 4.6,
    reviews: typeof m.review_count === "number" ? m.review_count : 0,
    medusaId: product.id,
    // Cuándo lo creó el scraper (solo modelos que entraron con la marca); el
    // panel lo usa para la etiqueta «Nuevo». Los anteriores no la tienen.
    firstSeenAt: typeof m.first_seen_at === "string" ? m.first_seen_at : null,
  };
}

function toCase(product) {
  const price = priceOf(product);
  return {
    sku: product.title,
    name: product.title,
    slug: "case-" + product.handle,
    brand: "Cases",
    brand_slug: "case",
    isCase: true,
    material: "",
    colors: colorsOf(product),
    price,
    basePrice: price,
    rating: typeof (product.metadata || {}).rating === "number" ? product.metadata.rating : 4.7,
    reviews: typeof (product.metadata || {}).review_count === "number" ? product.metadata.review_count : 0,
    medusaId: product.id,
  };
}

const FIELDS =
  "id,title,handle,description,thumbnail,*images,*variants,*variants.calculated_price,metadata";

// Curated collections: the store sells ONLY these 9 (8 frame brands + Cases).
// The backend catalog also contains other brands (Ago, Candy Shoppe, Versailles
// Palace, Eyeleos, Artistik Eyewear/Galerie, Simplylite, Slimfold) that come from
// other suppliers and have no real wholesale price — they must NOT appear in the
// storefront. We filter by brand_slug here rather than unpublishing in the
// backend so Dionis's catalog data stays intact and a brand can be re-enabled by
// editing this one list.
const ALLOWED_BRAND_SLUGS = new Set([
  "di-caprio", "peachtree", "4u", "millennial",
  "flexure", "trendy", "grande", "prorx", "case",
  // Simplylite: habilitada para publicar las monturas piloto con vistas 3D
  // generadas (galería de 4 ángulos). Precios reales en Medusa (~$18).
  "simply-lite",
]);

// Fetch every published product for the store's first region, paginated.
export async function loadFromMedusa() {
  const { regions } = await medusa.store.region.list();
  const region_id = regions && regions[0] && regions[0].id;

  const all = [];
  const limit = 100;
  let offset = 0;
  // Cap the loop defensively; a normal catalog is a few hundred products.
  for (let page = 0; page < 100; page++) {
    const { products, count } = await medusa.store.product.list({
      limit, offset, region_id, fields: FIELDS,
    });
    if (!products || !products.length) break;
    all.push(...products);
    offset += limit;
    if (offset >= (count || 0)) break;
  }

  const frames = [];
  const cases = [];
  for (const p of all) {
    const meta = p.metadata || {};
    const slug = meta.brand_slug || meta.collection_slug || "";
    // Un estuche se reconoce por su colección ("case", scraper) o por
    // `metadata.kind === "case"` (seed de QA / cargas manuales sin colección):
    // antes un estuche sin `brand_slug` se descartaba y la tienda se quedaba
    // sin estuches en modo Medusa.
    const isCase = slug === "case" || meta.kind === "case";
    // Skip any product outside the curated collections (see ALLOWED_BRAND_SLUGS).
    if (!isCase && !ALLOWED_BRAND_SLUGS.has(slug)) continue;
    if (isCase) cases.push(toCase(p));
    else frames.push(toFrame(p));
  }
  return { products: frames, cases };
}
