// Brands with real logos pulled from caprioptics.com
// Marcas activas (decisión de negocio): solo estas 9 se muestran y se venden.
// Las demás (candy-shoppe, artistik-galerie, eyeleos, versailles-palace,
// slimfold, ago, artistik-eyewear, simply-lite) quedan retiradas del sitio.
export const BRANDS = [
  { slug: "di-caprio", name: "Di Caprio", logo: "https://caprioptics.com/wp-content/uploads/NEW-DC-LOGO.jpg.png" },
  { slug: "peachtree", name: "Peachtree", logo: "https://caprioptics.com/wp-content/uploads/PT-logo2-600x184.jpg.png" },
  { slug: "flexure", name: "Flexure", logo: "https://caprioptics.com/wp-content/uploads/Capri-Logo-dragged-7.jpg.png" },
  { slug: "4u", name: "Four You", logo: "https://caprioptics.com/wp-content/uploads/4U-logo-copy.jpg.png" },
  { slug: "trendy", name: "Trendy", logo: "https://caprioptics.com/wp-content/uploads/trendy-logo2-300x83.jpg.png" },
  { slug: "millennial", name: "Millennial", logo: "https://caprioptics.com/wp-content/uploads/Capri-Logo-dragged-9.jpg.png" },
  { slug: "grande", name: "Grande", logo: "https://caprioptics.com/wp-content/uploads/Grande-Logo-dragged-600x106.jpg.png" },
  { slug: "prorx", name: "ProRx", logo: "https://caprioptics.com/wp-content/uploads/prorx-logo2-600x169.jpg.png" },
  { slug: "case", name: "Cases", logo: "https://caprioptics.com/wp-content/uploads/Capri-Logo-dragged-14.jpg.png" },
];

export const BRAND_BY_SLUG = Object.fromEntries(BRANDS.map((b) => [b.slug, b]));

// Slugs permitidos (para filtrar el catálogo). Se usa en catalogStore.
export const ALLOWED_BRAND_SLUGS = new Set(BRANDS.map((b) => b.slug));
