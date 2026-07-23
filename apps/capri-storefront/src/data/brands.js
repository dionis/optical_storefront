// Brands with real logos pulled from caprioptics.com
export const BRANDS = [
  { slug: "candy-shoppe", name: "The Candy Shoppe", logo: "https://caprioptics.com/wp-content/uploads/candy-shoppe-300x252.jpg.png" },
  { slug: "artistik-galerie", name: "Artistik Galerie", logo: "https://caprioptics.com/wp-content/uploads/AG-LOGO-300x271.jpg.png" },
  { slug: "eyeleos", name: "Eyeleos", logo: "https://caprioptics.com/wp-content/uploads/eyelos-jpg-scaled-e1737653692562.jpg" },
  { slug: "di-caprio", name: "Di Caprio", logo: "https://caprioptics.com/wp-content/uploads/NEW-DC-LOGO.jpg.png" },
  { slug: "versailles-palace", name: "Versailles Palace", logo: "https://caprioptics.com/wp-content/uploads/VP-logo-larger-600x100.jpg.png" },
  { slug: "peachtree", name: "Peachtree", logo: "https://caprioptics.com/wp-content/uploads/PT-logo2-600x184.jpg.png" },
  { slug: "slimfold", name: "Slimfold", logo: "https://caprioptics.com/wp-content/uploads/slimfold-logo2-600x173.jpg.png" },
  { slug: "ago", name: "Ago", logo: "https://caprioptics.com/wp-content/uploads/Ago-JPG-05-600x484.jpg.png" },
  { slug: "artistik-eyewear", name: "Artistik Eyewear", logo: "https://caprioptics.com/wp-content/uploads/ART-LOGO-300x254.jpg.png" },
  { slug: "flexure", name: "Flexure", logo: "https://caprioptics.com/wp-content/uploads/Capri-Logo-dragged-7.jpg.png" },
  { slug: "trendy", name: "Trendy", logo: "https://caprioptics.com/wp-content/uploads/trendy-logo2-300x83.jpg.png" },
  { slug: "4u", name: "Four You", logo: "https://caprioptics.com/wp-content/uploads/4U-logo-copy.jpg.png" },
  { slug: "case", name: "Cases", logo: "https://caprioptics.com/wp-content/uploads/Capri-Logo-dragged-14.jpg.png" },
  { slug: "simply-lite", name: "Simplylite", logo: "https://caprioptics.com/wp-content/uploads/Simplylite-logo-silver-01-600x194.jpg.png" },
  { slug: "grande", name: "Grande", logo: "https://caprioptics.com/wp-content/uploads/Grande-Logo-dragged-600x106.jpg.png" },
  { slug: "millennial", name: "Millennial", logo: "https://caprioptics.com/wp-content/uploads/Capri-Logo-dragged-9.jpg.png" },
  { slug: "prorx", name: "ProRx", logo: "https://caprioptics.com/wp-content/uploads/prorx-logo2-600x169.jpg.png" },
];

export const BRAND_BY_SLUG = Object.fromEntries(BRANDS.map((b) => [b.slug, b]));
