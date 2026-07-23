// Eyeglass cases / estuches — real products from caprioptics.com (Cases brand).
const RAW = [
  { sku: "ANGLEFIT", name: "AngleFit", colors: [{ name: "Transparente", image: "https://caprioptics.com/wp-content/uploads/angelfit-scaled.jpg" }] },
  { sku: "CAPRIO-CASE", name: "Caprio Case", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/NEW-DC-scaled.jpg" }] },
  { sku: "C-1", name: "Case C-1", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c1.jpg" }] },
  { sku: "C-11", name: "Case C-11", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c-11-scaled.jpg" }] },
  { sku: "C-15", name: "Case C-15", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/C-15-scaled.jpg" }] },
  { sku: "C-2", name: "Case C-2", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c2-scaled.jpg" }] },
  { sku: "C-20", name: "Case C-20", colors: [{ name: "Black", image: "https://caprioptics.com/wp-content/uploads/C20.jpg" }] },
  { sku: "C-24", name: "Case C-24", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c24.jpg" }] },
  { sku: "C-25", name: "Case C-25", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c25.jpg" }] },
  { sku: "C-26", name: "Case C-26", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c26.jpg" }] },
  { sku: "C-3", name: "Case C-3", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c-3-scaled.jpg" }] },
  { sku: "C-6", name: "Case C-6", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c-6-scaled.jpg" }] },
  { sku: "C-8", name: "Case C-8", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c-8-scaled.jpg" }] },
  { sku: "KC-3", name: "Case KC-3", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/kc-3%20multi.jpg" }] },
  { sku: "SC-1", name: "Case SC-1", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/sc-1-scaled.jpg" }] },
  { sku: "SC-2", name: "Case SC-2 c/clip", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/sc-2-scaled.jpg" }] },
  { sku: "SC-4", name: "Case SC-4", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/sc-4-scaled.jpg" }] },
  { sku: "SC-5", name: "Case SC-5", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/sc-5.JPG" }] },
  { sku: "SC-6", name: "Case SC-6", colors: [{ name: "Black", image: "https://caprioptics.com/wp-content/uploads/sc-6-scaled.jpg" }] },
  { sku: "SE-2", name: "Case SE-2", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/SE-2-scaled.jpg" }] },
  { sku: "SE-3", name: "Case SE-3", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/SE3.jpg" }] },
  { sku: "SE-4", name: "Case SE-4", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/SE-4-scaled.jpg" }] },
  { sku: "DICAPRIO-CASE", name: "Di Caprio Case", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/DC%20CASE-scaled.jpg" }] },
  { sku: "GRANDE-CASE", name: "Grande Case", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/GRANDE%20CASE-scaled.jpg" }], material: "Estuche rígido XL / XL hard case" },
  { sku: "SL-CASE", name: "Simplylite Case", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/SL%20Case-scaled.jpg" }], material: "Estuche rígido / Hard case" },
  { sku: "SPECIAL-C1", name: "Special C1", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c1.jpg" }] },
  { sku: "SPECIAL-C2", name: "Special C2", colors: [{ name: "Multi", image: "https://caprioptics.com/wp-content/uploads/c2-scaled.jpg" }] },
];

function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff; return Math.abs(h); }
const priceFor = (sku) => Math.round((5.95 + (hash(sku) % 8)) * 100) / 100;
const ratingFor = (sku) => Math.round((4.4 + (hash(sku + "r") % 6) / 10) * 10) / 10;
const CHEX = { multi: "#9aa3b0", black: "#1a1a1a", transparente: "#dfe6ee", clear: "#dfe6ee" };
const chex = (n) => CHEX[n.toLowerCase()] || "#9aa3b0";

const reviewsFor = (sku) => 12 + (hash(sku + "rv") % 180);

export const CASES = RAW.map((c) => ({
  ...c,
  slug: "case-" + c.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  brand: "Cases",
  brand_slug: "case",
  isCase: true,
  material: c.material || "",
  price: priceFor(c.sku),
  rating: ratingFor(c.sku),
  reviews: reviewsFor(c.sku),
  colors: c.colors.map((x) => ({ ...x, hex: chex(x.name) })),
}));

export const CASE_BY_SLUG = Object.fromEntries(CASES.map((c) => [c.slug, c]));

export function recommendedCases(seed, n = 3) {
  const start = hash(seed || "x") % CASES.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(CASES[(start + i) % CASES.length]);
  return out;
}
