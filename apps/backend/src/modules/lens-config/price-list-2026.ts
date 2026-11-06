/**
 * The 2026 lens price list (the owner's master), in one place so the seed
 * migration (UpgradeLensList2026Seed7), the pricing panel's overview, the
 * tests and the storefront's static fallback (capri-storefront
 * src/data/lensPricing.js — keep it in sync by hand) agree on every number.
 *
 * Amounts are USD dollars here; the migration multiplies to cents (the
 * lens-config module stores integers).
 */

export const MATERIAL_CODES = ["cr39", "poly", "1.56", "1.61", "1.67", "1.74"] as const;
export type MaterialCode = (typeof MATERIAL_CODES)[number];

export interface MaterialRow {
  code: MaterialCode;
  label_es: string;
  label_en: string;
  desc_es: string;
  desc_en: string;
  max_abs: number;
  sort: number;
}

export const MATERIALS: MaterialRow[] = [
  { code: "cr39", label_es: "CR-39 (Resina)", label_en: "CR-39 (Resin)", desc_es: "Estándar, económico.", desc_en: "Standard, budget.", max_abs: 2, sort: 0 },
  { code: "poly", label_es: "Policarbonato", label_en: "Polycarbonate", desc_es: "Resistente a impactos. Niños/deporte.", desc_en: "Impact-resistant. Kids/sport.", max_abs: 3, sort: 1 },
  { code: "1.56", label_es: "Índice 1.56", label_en: "Index 1.56", desc_es: "Más delgado que CR-39.", desc_en: "Thinner than CR-39.", max_abs: 3, sort: 2 },
  { code: "1.61", label_es: "Índice 1.61", label_en: "Index 1.61", desc_es: "Delgado.", desc_en: "Thin.", max_abs: 4, sort: 3 },
  { code: "1.67", label_es: "Índice 1.67", label_en: "Index 1.67", desc_es: "Muy delgado.", desc_en: "Very thin.", max_abs: 6, sort: 4 },
  { code: "1.74", label_es: "Índice 1.74", label_en: "Index 1.74", desc_es: "Ultra delgado. Alta graduación.", desc_en: "Ultra-thin. High Rx.", max_abs: 99, sort: 5 },
];

export interface DesignRow {
  code: string;
  category: "sv" | "bifocal" | "prog";
  label_es: string;
  label_en: string;
  requires_rx: boolean;
  requires_add: boolean;
  sort: number;
  /** Named progressive designs only: the tier label the owner uses ("Básico" … "Elite"). */
  tier: string | null;
  use_es: string | null;
  use_en: string | null;
  /** Base price per material (USD). */
  prices: Record<MaterialCode, number>;
}

/** Named progressive: "desde" price for CR-39/Poly/1.56/1.61; 1.67 and 1.74 add the tier's step. */
const progressive = (from: number, cls: "mid" | "high"): Record<MaterialCode, number> => {
  const step = cls === "high" ? { "1.67": 40, "1.74": 90 } : { "1.67": 20, "1.74": 50 };
  return { cr39: from, poly: from, "1.56": from, "1.61": from, "1.67": from + step["1.67"], "1.74": from + step["1.74"] };
};

export const DESIGNS: DesignRow[] = [
  { code: "sv", category: "sv", label_es: "Visión Sencilla", label_en: "Single Vision", requires_rx: true, requires_add: false, sort: 0, tier: null, use_es: null, use_en: null,
    prices: { cr39: 60, poly: 90, "1.56": 100, "1.61": 100, "1.67": 120, "1.74": 150 } },
  // The owner's lab sheet splits the FT-28 bifocal family into "tallado"
  // (surfaced in the lab) and "de stock" (finished lens from inventory); the old
  // single "bifocal" row is retired (RETIRED_DESIGN_CODES) and these two take its
  // category, so photochromic/AR pricing per category is unchanged. Both start
  // at the old bifocal price — the owner sets each store's price in the panel.
  { code: "tallado", category: "bifocal", label_es: "Tallado", label_en: "Surfaced", requires_rx: true, requires_add: true, sort: 1, tier: null, use_es: null, use_en: null,
    prices: { cr39: 130, poly: 140, "1.56": 140, "1.61": 140, "1.67": 160, "1.74": 160 } },
  { code: "stock", category: "bifocal", label_es: "De stock", label_en: "Stock", requires_rx: true, requires_add: true, sort: 2, tier: null, use_es: null, use_en: null,
    prices: { cr39: 130, poly: 140, "1.56": 140, "1.61": 140, "1.67": 160, "1.74": 160 } },
  { code: "prog-mid", category: "prog", label_es: "Progresivo Gama Media", label_en: "Progressive · Mid", requires_rx: true, requires_add: true, sort: 2, tier: null, use_es: null, use_en: null,
    prices: { cr39: 180, poly: 180, "1.56": 180, "1.61": 180, "1.67": 200, "1.74": 230 } },
  { code: "prog-high", category: "prog", label_es: "Progresivo Gama Alta", label_en: "Progressive · Premium", requires_rx: true, requires_add: true, sort: 3, tier: null, use_es: null, use_en: null,
    prices: { cr39: 240, poly: 240, "1.56": 240, "1.61": 240, "1.67": 280, "1.74": 300 } },
  // Named digital progressive designs (2026 list). `tier` is the owner's label; the
  // "desde" price is the base for CR-39/Poly/1.56/1.61.
  { code: "purity-basic", category: "prog", label_es: "Purity Basic", label_en: "Purity Basic", requires_rx: true, requires_add: true, sort: 10, tier: "Básico",
    use_es: "Nuevos usuarios / uso diario", use_en: "New wearers / everyday use", prices: progressive(160, "mid") },
  { code: "purity-plus", category: "prog", label_es: "Purity Plus", label_en: "Purity Plus", requires_rx: true, requires_add: true, sort: 11, tier: "Intermedio",
    use_es: "Uso diario, más campo visual", use_en: "Everyday use, wider field", prices: progressive(180, "mid") },
  { code: "dvg-distinct", category: "prog", label_es: "DVG Distinct", label_en: "DVG Distinct", requires_rx: true, requires_add: true, sort: 12, tier: "Avanzado",
    use_es: "Uso general equilibrado", use_en: "Balanced general use", prices: progressive(240, "high") },
  { code: "dvg-drive", category: "prog", label_es: "DVG Drive", label_en: "DVG Drive", requires_rx: true, requires_add: true, sort: 13, tier: "Avanzado",
    use_es: "Conducción frecuente", use_en: "Frequent driving", prices: progressive(250, "high") },
  { code: "purity-office", category: "prog", label_es: "Purity Office", label_en: "Purity Office", requires_rx: true, requires_add: true, sort: 14, tier: "Premium",
    use_es: "Oficina y computadora", use_en: "Office and computer", prices: progressive(200, "high") },
  { code: "dvg-cubicle", category: "prog", label_es: "DVG Cubicle", label_en: "DVG Cubicle", requires_rx: true, requires_add: true, sort: 15, tier: "Premium",
    use_es: "Oficina y computadora (campo cercano amplio)", use_en: "Office and computer (wide near field)", prices: progressive(210, "high") },
  { code: "dvg-aqueous", category: "prog", label_es: "DVG Aqueous", label_en: "DVG Aqueous", requires_rx: true, requires_add: true, sort: 16, tier: "Premium superior",
    use_es: "Profesionales y ejecutivos", use_en: "Professionals and executives", prices: progressive(260, "high") },
  { code: "dvg-maverick", category: "prog", label_es: "DVG Maverick (Pilot)", label_en: "DVG Maverick (Pilot)", requires_rx: true, requires_add: true, sort: 17, tier: "Premium superior",
    use_es: "Alto desempeño y viajeros", use_en: "High performance and travellers", prices: progressive(280, "high") },
  { code: "dvg-camber", category: "prog", label_es: "DVG Camber", label_en: "DVG Camber", requires_rx: true, requires_add: true, sort: 18, tier: "Elite",
    use_es: "Máxima tecnología", use_en: "Top technology", prices: progressive(300, "high") },
];

export interface PhotoRow {
  code: string;
  label_es: string;
  label_en: string;
  colors: string[];
  /** USD per design category; null = not offered for that category. */
  sv: number | null;
  bifocal: number | null;
  prog: number | null;
  sort: number;
}

export const PHOTO_OPTIONS: PhotoRow[] = [
  { code: "photo-grey", label_es: "Fotocromático Grey", label_en: "Photochromic Grey", colors: ["grey"], sv: 85, bifocal: 110, prog: 90, sort: 0 },
  { code: "photo-brown", label_es: "Fotocromático Brown", label_en: "Photochromic Brown", colors: ["brown"], sv: null, bifocal: 110, prog: 90, sort: 1 },
  { code: "trans-s-grey", label_es: "Transitions Gen S Grey", label_en: "Transitions Gen S Grey", colors: ["grey"], sv: 105, bifocal: 105, prog: 105, sort: 2 },
  { code: "trans-s-brown", label_es: "Transitions Gen S Brown", label_en: "Transitions Gen S Brown", colors: ["brown"], sv: 105, bifocal: 105, prog: 105, sort: 3 },
  { code: "trans-s-green", label_es: "Transitions Gen S Graphite Green", label_en: "Transitions Gen S Graphite Green", colors: ["green"], sv: 105, bifocal: 105, prog: 105, sort: 4 },
  { code: "trans-x-grey", label_es: "Transitions XTRActive Grey", label_en: "Transitions XTRActive Grey", colors: ["grey"], sv: 130, bifocal: 130, prog: 130, sort: 5 },
  { code: "trans-x-brown", label_es: "Transitions XTRActive Brown (RAM)", label_en: "Transitions XTRActive Brown (RAM)", colors: ["brown"], sv: 130, bifocal: 130, prog: 130, sort: 6 },
];

export interface ArRow {
  code: string;
  label_es: string;
  label_en: string;
  /** "sv" = single vision only; "bifprog" = bifocals and progressives. */
  ar_group: "sv" | "bifprog";
  price: number;
  sort: number;
}

export const AR_OPTIONS: ArRow[] = [
  { code: "ar-green-basic", label_es: "AR Green Básico", label_en: "AR Green Basic", ar_group: "sv", price: 60, sort: 0 },
  { code: "ar-green-plus", label_es: "AR Green Plus", label_en: "AR Green Plus", ar_group: "sv", price: 90, sort: 1 },
  { code: "ar-blue-protect", label_es: "AR Blue Protect", label_en: "AR Blue Protect", ar_group: "sv", price: 90, sort: 2 },
  { code: "adequate", label_es: "Adequate", label_en: "Adequate", ar_group: "bifprog", price: 50, sort: 3 },
  { code: "crystal", label_es: "Crystal", label_en: "Crystal", ar_group: "bifprog", price: 80, sort: 4 },
  { code: "flawless", label_es: "Flawless", label_en: "Flawless", ar_group: "bifprog", price: 120, sort: 5 },
  { code: "blue-uv-445", label_es: "Blue UV 445", label_en: "Blue UV 445", ar_group: "bifprog", price: 120, sort: 6 },
];

/** AR options the RUBILENT interlude introduced; the 2026 list replaces them. */
export const RETIRED_AR_CODES = ["ar-green", "ar-blue"] as const;
/** Designs no longer offered (kept in the DB, inactive, so old sales keep their breakdown). */
export const RETIRED_DESIGN_CODES = ["bifocal"] as const;

export const cents = (usd: number | null): number | null => (usd == null ? null : Math.round(usd * 100));

/** SQL literal helpers used by the seed migration (values are our own constants, never user input). */
export const sqlText = (s: string | null): string => (s == null ? "NULL" : `'${s.replace(/'/g, "''")}'`);
export const sqlNum = (n: number | null): string => (n == null ? "NULL" : String(n));
export const sqlArray = (a: string[]): string => `'{${a.map((x) => x.replace(/[{}",\\]/g, "")).join(",")}}'`;
