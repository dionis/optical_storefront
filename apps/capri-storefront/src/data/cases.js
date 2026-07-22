// Eyeglass cases / estuches — real products from caprioptics.com (Cases brand).
const RAW = [
  { sku: "C-26", name: "Case C-26", image: "https://caprioptics.com/wp-content/uploads/c26.jpg", material: "" },
  { sku: "C-25", name: "Case C-25", image: "https://caprioptics.com/wp-content/uploads/c25.jpg", material: "" },
  { sku: "C-24", name: "Case C-24", image: "https://caprioptics.com/wp-content/uploads/c24.jpg", material: "" },
  { sku: "ANGLEFIT", name: "AngleFit", image: "https://caprioptics.com/wp-content/uploads/angelfit-scaled.jpg", material: "Transparente / Transparent" },
  { sku: "SE-4", name: "Case SE-4", image: "https://caprioptics.com/wp-content/uploads/SE-4-scaled.jpg", material: "" },
  { sku: "SL-CASE", name: "Simplylite Case", image: "https://caprioptics.com/wp-content/uploads/SL%20Case-scaled.jpg", material: "Estuche rígido / Hard case" },
  { sku: "C-20", name: "Case C-20", image: "https://caprioptics.com/wp-content/uploads/C20.jpg", material: "" },
  { sku: "C-15", name: "Special C-15", image: "https://caprioptics.com/wp-content/uploads/C-15-scaled.jpg", material: "" },
  { sku: "GRANDE-CASE", name: "Grande Case", image: "https://caprioptics.com/wp-content/uploads/GRANDE%20CASE-scaled.jpg", material: "Estuche rígido XL / XL hard case" },
  { sku: "SE-3", name: "Case SE-3", image: "https://caprioptics.com/wp-content/uploads/SE3.jpg", material: "" },
];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h);
}
const priceFor = (sku) => Math.round((5.95 + (hash(sku) % 8)) * 100) / 100;
const ratingFor = (sku) => Math.round((4.4 + (hash(sku + "r") % 6) / 10) * 10) / 10;

export const CASES = RAW.map((c) => ({
  ...c,
  slug: "case-" + c.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  brand: "Cases",
  brand_slug: "case",
  isCase: true,
  price: priceFor(c.sku),
  rating: ratingFor(c.sku),
}));

// Deterministic set of N case recommendations for a given product SKU.
export function recommendedCases(seed, n = 3) {
  const start = hash(seed || "x") % CASES.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(CASES[(start + i) % CASES.length]);
  return out;
}
