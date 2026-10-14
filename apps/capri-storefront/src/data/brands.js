// Curated collections shown in the store (8 frame brands + Cases). Only these 9
// Logos: medallones de la lámina de marca del dueño, individualizados y
// recortados en círculo con fondo transparente (public/brands/brand-<slug>.png)
// — antes se hotlinkeaban del proveedor. `logoWide` es el logo PLANO individual
// (lámina del dueño, fondo transparente): héroe de marca en el catálogo y sello
// de marca del PDP; el medallón queda para los círculos de la portada.
// are sold; other brands present in the supplier catalog are intentionally
// excluded here AND filtered out of the product catalog (see
// medusaCatalog.js → ALLOWED_BRAND_SLUGS). Order matches the brands page layout.
export const BRANDS = [
  { slug: "di-caprio", name: "Di Caprio", logo: "/brands/brand-di-caprio.png", logoWide: "/brands/logo-di-caprio.png" },
  { slug: "peachtree", name: "Peachtree", logo: "/brands/brand-peachtree.png", logoWide: "/brands/logo-peachtree.png" },
  { slug: "flexure", name: "Flexure", logo: "/brands/brand-flexure.png", logoWide: "/brands/logo-flexure.png" },
  { slug: "4u", name: "Four You", logo: "/brands/brand-4u.png", logoWide: "/brands/logo-4u.png" },
  { slug: "trendy", name: "Trendy", logo: "/brands/brand-trendy.png", logoWide: "/brands/logo-trendy.png" },
  { slug: "millennial", name: "Millennial", logo: "/brands/brand-millennial.png", logoWide: "/brands/logo-millennial.png" },
  { slug: "grande", name: "Grande", logo: "/brands/brand-grande.png", logoWide: "/brands/logo-grande.png" },
  { slug: "prorx", name: "ProRx", logo: "/brands/brand-prorx.png", logoWide: "/brands/logo-prorx.png" },
  { slug: "case", name: "Cases", logo: "/brands/brand-case.png", logoWide: "/brands/logo-case.png" },
];

export const BRAND_BY_SLUG = Object.fromEntries(BRANDS.map((b) => [b.slug, b]));
