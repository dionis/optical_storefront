// ─────────────────────────────────────────────────────────────
// Catálogo desde el backend Medusa (vía proxy MISMO ORIGEN `/medusa`,
// resuelto por Vite en dev y por Vercel rewrite en prod → sin CORS).
// Mapea el producto de Medusa a la forma RAW que espera enrichProducts()
// (products.js): { sku, name, brand, brand_slug, colors[{name,image}], attributes{...} }.
// Los buckets de tamaño y los brand_slug ya vienen en el formato del frontend;
// solo traducimos shape/gender/age/material inglés → español (vocabulario de filters.js).
// ─────────────────────────────────────────────────────────────

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const PROXY = "/medusa"; // proxy same-origin → backend
// Publishable key de Medusa (es PÚBLICA por diseño: viaja al navegador). Fallback al valor
// actual para que el deploy funcione aunque falte la env en Vercel; se puede sobreescribir
// con VITE_MEDUSA_PUBLISHABLE_KEY en Vercel.
const PK = env.VITE_MEDUSA_PUBLISHABLE_KEY ||
  "pk_4207238465abeb79cf080e8ab85278a23aecbf56f92cb67c1f4735c375be2e61";
// Base pública de imágenes (Supabase/R2). También pública.
const R2 = String(
  env.VITE_R2_PUBLIC_URL ||
  "https://svuuuobjgrkscsjgpwkx.supabase.co/storage/v1/object/public/eyewear-assets"
).replace(/\/$/, "");
// Migración incremental: activo por defecto; desactivar con VITE_USE_MEDUSA=false.
const USE = String(env.VITE_USE_MEDUSA ?? "true").toLowerCase() !== "false";

export const medusaEnabled = () => USE;

// Traducciones inglés → español (valores canónicos que exige filters.js).
const SHAPE = {
  "aviator": "Aviador", "cat-eye": "Ojo de gato", "geometric": "Geométrico",
  "modified-oval": "Óvalo modificado", "modified-round": "Ronda modificada",
  "navigator": "Navegador", "rectangle": "Rectángulo", "round": "Redondo",
  "square": "Cuadrado", "oval": "Oval", "combo": "Combo", "full-frame": "Marco completo",
};
const GENDER = { "women": "Señoras", "men": "Hombres", "unisex": "Unisexo" };
const AGE = { "adult": "Adulto", "kids": "Niños", "youth": "Niños", "junior": "Niños" };
const MATERIAL = {
  "acetate": "Acetato", "metal": "Metal", "plastic": "Plástica",
  "injection": "Inyección", "injection-2": "Inyección", "memory": "Memoria",
  "stainless": "Acero inoxidable", "stainless-steel": "Acero inoxidable",
  "titanium": "Titanio", "tr-90": "TR-90", "tr90": "TR-90", "ultem": "Ultem",
};
const tr = (map, v) => (v == null ? "" : (map[String(v).toLowerCase()] || ""));

function imgUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;           // ya es URL completa
  return R2 ? `${R2}/${String(u).replace(/^\//, "")}` : u; // relativa → prepende base R2
}

async function api(path) {
  const res = await fetch(`${PROXY}${path}`, {
    headers: PK ? { "x-publishable-api-key": PK } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error("medusa " + res.status);
  return res.json();
}

let regionId = null;
async function getRegion() {
  if (regionId) return regionId;
  try {
    const d = await api("/store/regions");
    regionId = d.regions?.[0]?.id || null;
  } catch { regionId = null; }
  return regionId;
}

function mapProduct(p) {
  const md = p.metadata || {};
  const colorOpt = (p.options || []).find((o) => /color/i.test(o.title || ""));
  const colorVals = colorOpt ? (colorOpt.values || []).map((v) => v.value) : [];
  const images = (p.images || []).map((i) => i.url).filter(Boolean);
  const colors = (colorVals.length ? colorVals : ["Único"]).map((name, i) => ({
    name,
    image: imgUrl(images[i] || images[0] || p.thumbnail),
  }));
  // Precio real del backend (mínimo entre variantes, en la moneda de la región).
  const amts = (p.variants || [])
    .map((v) => v.calculated_price && v.calculated_price.calculated_amount)
    .filter((x) => typeof x === "number");
  const price = amts.length ? Math.min(...amts) : null;
  const material = tr(MATERIAL, md.material);
  return {
    sku: p.title || p.handle,
    name: p.title || p.handle,
    brand: md.brand || "",
    brand_slug: md.brand_slug || "",
    colors,
    attributes: {
      eye_size: md.eye_size_bucket || "",
      bridge_size: md.bridge_size_bucket || "",
      temple_length: md.temple_length_bucket || "",
      material: material ? [material] : [],
      gender: tr(GENDER, md.gender),
      age: tr(AGE, md.age_group),
      shape: tr(SHAPE, md.shape),
    },
    _medusaPrice: price,
    _medusaRating: typeof md.rating === "number" ? md.rating : undefined,
    _medusaReviews: typeof md.review_count === "number" ? md.review_count : undefined,
  };
}

// Trae TODOS los productos y los mapea. La primera página da el `count`; el resto
// se pide EN PARALELO para que el catálogo cargue rápido (evita el "flash" de datos
// seed en enlaces directos). Lanza si el backend no responde (catalogStore hace
// fallback a catalog.json / seed).
export async function fetchMedusaFrames() {
  const rid = await getRegion();
  const fields =
    "%2Bmetadata,%2Bimages.url,%2Bthumbnail,%2Boptions.title,%2Boptions.values.value,%2Bvariants.calculated_price";
  const url = (offset) =>
    `/store/products?limit=100&offset=${offset}${rid ? "&region_id=" + rid : ""}&fields=${fields}`;

  const first = await api(url(0));
  let out = (first.products || []).map(mapProduct);
  const count = first.count || out.length;

  const offsets = [];
  for (let o = 100; o < count; o += 100) offsets.push(o);
  if (offsets.length) {
    const rest = await Promise.all(
      offsets.map((o) => api(url(o)).then((d) => (d.products || []).map(mapProduct)).catch(() => []))
    );
    for (const arr of rest) out = out.concat(arr);
  }
  return out;
}
