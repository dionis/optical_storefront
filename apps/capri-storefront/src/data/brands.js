// Curated collections shown in the store (8 frame brands + Cases). Only these 9
// Logos: medallones de la lámina de marca del dueño, individualizados y
// recortados en círculo con fondo transparente (public/brands/medal-<slug>.png)
// — antes se hotlinkeaban del proveedor. `logoWide` es el logo PLANO individual
// (lámina del dueño, fondo transparente): héroe de marca en el catálogo y sello
// de marca del PDP; el medallón queda para los círculos de la portada.
// are sold; other brands present in the supplier catalog are intentionally
// excluded here AND filtered out of the product catalog (see
// medusaCatalog.js → ALLOWED_BRAND_SLUGS). Order matches the brands page layout.
export const BRANDS = [
  { slug: "di-caprio", name: "Di Caprio", logo: "/brands/medal-di-caprio.png", logoWide: "/brands/logo-di-caprio.png" },
  { slug: "peachtree", name: "Peachtree", logo: "/brands/medal-peachtree.png", logoWide: "/brands/logo-peachtree.png" },
  { slug: "flexure", name: "Flexure", logo: "/brands/medal-flexure.png", logoWide: "/brands/logo-flexure.png" },
  { slug: "4u", name: "Four You", logo: "/brands/medal-4u.png", logoWide: "/brands/logo-4u.png" },
  { slug: "trendy", name: "Trendy", logo: "/brands/medal-trendy.png", logoWide: "/brands/logo-trendy.png" },
  { slug: "millennial", name: "Millennial", logo: "/brands/medal-millennial.png", logoWide: "/brands/logo-millennial.png" },
  { slug: "grande", name: "Grande", logo: "/brands/medal-grande.png", logoWide: "/brands/logo-grande.png" },
  { slug: "prorx", name: "ProRx", logo: "/brands/medal-prorx.png", logoWide: "/brands/logo-prorx.png" },
  { slug: "case", name: "Cases", logo: "/brands/medal-case.png", logoWide: "/brands/logo-case.png" },
];

export const BRAND_BY_SLUG = Object.fromEntries(BRANDS.map((b) => [b.slug, b]));

// Busca la marca por su NOMBRE visible ("Peachtree", "Di Caprio"…): lo que
// llevan los productos en product.brand. Para sellos/marcas de agua por marca.
export function brandByName(name) {
  const n = String(name || "").trim().toLowerCase();
  return BRANDS.find((x) => x.name.toLowerCase() === n) || null;
}
