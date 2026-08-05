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
import { resolveImage } from "./imageUrl.js";

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

function colorsOf(product) {
  const variants = product.variants || [];
  const images = (product.images || []).map((i) => i.url);
  return variants.map((v, i) => {
    const name = v.title || (v.metadata && v.metadata.color) || "Default";
    const raw = (v.metadata && v.metadata.image) || images[i] || product.thumbnail || images[0] || "";
    return { name, image: resolveImage(raw), hex: hexFor(name), variantId: v.id };
  });
}

function toFrame(product) {
  const m = product.metadata || {};
  const materials = m.material ? [mapEnum(MATERIAL_ES, m.material)] : [];
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
      eye_size: m.eye_size_bucket || "",
      bridge_size: m.bridge_size_bucket || "",
      temple_length: m.temple_length_bucket || "",
    },
    price,
    basePrice: price,
    rating: typeof m.rating === "number" ? m.rating : 4.6,
    reviews: typeof m.review_count === "number" ? m.review_count : 0,
    medusaId: product.id,
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
    const slug = ((p.metadata || {}).brand_slug || (p.metadata || {}).collection_slug || "");
    // Skip any product outside the curated collections (see ALLOWED_BRAND_SLUGS).
    if (!ALLOWED_BRAND_SLUGS.has(slug)) continue;
    if (slug === "case") cases.push(toCase(p));
    else frames.push(toFrame(p));
  }
  return { products: frames, cases };
}
