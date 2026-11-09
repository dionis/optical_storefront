/**
 * Lens designs of the master list (Visión sencilla, Bifocal FT-28, Progresivo
 * gama media…) and the cells that price them, managed from «Productos y
 * precios» → Lentes (docs/PRICE-MATRIX.md §12). Pure validation only: the
 * writers are in lib/lens-design-data.ts.
 */
import { parseLensFinish, type LensFinish } from "./lens-finish";

export const LENS_CATEGORIES = ["sv", "bifocal", "prog"] as const;
export type LensCategory = (typeof LENS_CATEGORIES)[number];

const MAX_AMOUNT_USD = 100_000;
const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && !v.trim());
const label = (v: unknown, max = 80): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const optText = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (blank(v)) return null;
  return typeof v === "string" && v.trim().length <= max ? v.trim() : undefined;
};

/** Dollars typed in the panel → cents; null when empty; undefined when not a valid amount. */
export function moneyCents(v: unknown): number | null | undefined {
  if (blank(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT_USD) return undefined;
  return Math.round(n * 100);
}

/** A code like the seeded ones from a label: «Progresivo Gama Alta» → «progresivo-gama-alta». */
export function deriveLensCode(text: string, taken: ReadonlySet<string>): string {
  const base =
    String(text)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "lens";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

export interface LensDesignInput {
  label_es: string;
  label_en: string;
  category: LensCategory;
  /** Explicit code; null = derived from the label. */
  code: string | null;
  requires_add: boolean;
  tier: string | null;
  use_es: string | null;
  use_en: string | null;
}

/**
 * `POST /admin/pricing/lens-designs`. Labels: both or either (the other copies
 * it). `requires_add` defaults to true for bifocals and progressives (they
 * need an addition in the prescription). Reasons: `bad_label`, `bad_category`,
 * `bad_value`. Pure.
 */
export function cleanLensDesign(body: Record<string, unknown>): { design: LensDesignInput } | { reason: string } {
  const es = label(body["label_es"]);
  const en = label(body["label_en"]);
  if (!es && !en) return { reason: "bad_label" };
  if ((!blank(body["label_es"]) && !es) || (!blank(body["label_en"]) && !en)) return { reason: "bad_label" };
  const category = body["category"];
  if (!LENS_CATEGORIES.includes(category as LensCategory)) return { reason: "bad_category" };
  let code: string | null = null;
  if (!blank(body["code"])) {
    const c = String(body["code"]).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{0,59}$/.test(c)) return { reason: "bad_value" };
    code = c;
  }
  const add = body["requires_add"];
  if (add !== undefined && typeof add !== "boolean") return { reason: "bad_value" };
  const tier = optText(body["tier"], 40);
  const useEs = optText(body["use_es"], 160);
  const useEn = optText(body["use_en"], 160);
  if (tier === undefined && body["tier"] !== undefined) return { reason: "bad_value" };
  if ((useEs === undefined && body["use_es"] !== undefined) || (useEn === undefined && body["use_en"] !== undefined)) return { reason: "bad_value" };
  return {
    design: {
      label_es: (es ?? en) as string,
      label_en: (en ?? es) as string,
      category: category as LensCategory,
      code,
      requires_add: typeof add === "boolean" ? add : category !== "sv",
      tier: tier ?? null,
      use_es: useEs ?? null,
      use_en: useEn ?? null,
    },
  };
}

export interface LensDesignPatch {
  label_es?: string;
  label_en?: string;
  requires_add?: boolean;
  tier?: string | null;
  use_es?: string | null;
  use_en?: string | null;
  sort?: number;
}

/**
 * `POST /admin/pricing/lens-designs/:code`: only the keys sent. The category
 * cannot change (its cells' finish rules hang on it: a progressive is always
 * digital) — create another design instead. Reasons: `bad_label`, `bad_value`,
 * `bad_category`, `nothing_to_change`. Pure.
 */
export function cleanLensDesignPatch(body: Record<string, unknown>): { patch: LensDesignPatch } | { reason: string } {
  if ("category" in body) return { reason: "bad_category" };
  const patch: LensDesignPatch = {};
  for (const k of ["label_es", "label_en"] as const) {
    if (!(k in body)) continue;
    const v = label(body[k]);
    if (!v) return { reason: "bad_label" };
    patch[k] = v;
  }
  if ("requires_add" in body) {
    if (typeof body["requires_add"] !== "boolean") return { reason: "bad_value" };
    patch.requires_add = body["requires_add"];
  }
  for (const [k, max] of [["tier", 40], ["use_es", 160], ["use_en", 160]] as const) {
    if (!(k in body)) continue;
    const v = optText(body[k], max);
    if (v === undefined) return { reason: "bad_value" };
    patch[k] = v;
  }
  if ("sort" in body) {
    const n = Number(body["sort"]);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { reason: "bad_value" };
    patch.sort = n;
  }
  if (!Object.keys(patch).length) return { reason: "nothing_to_change" };
  return { patch };
}

export interface LensCellInput {
  /** An existing material, or a new one to create first. */
  material: { code: string } | { label_es: string; label_en: string; max_abs: number | null };
  finish: LensFinish;
  price_cents: number;
  cost_cents: number | null;
}

/**
 * `POST /admin/pricing/lens-designs/:code/cells` { material_code | new_material:
 * { label_es, label_en, max_abs? }, finish?, price, cost? }. A progressive's
 * cell is always digital (`finish_unavailable` otherwise). Reasons:
 * `bad_material`, `bad_label`, `bad_value`, `finish_unavailable`. Pure.
 */
export function cleanLensCell(body: Record<string, unknown>, category: string): { cell: LensCellInput } | { reason: string } {
  let material: LensCellInput["material"];
  const nm = body["new_material"];
  if (nm && typeof nm === "object" && !Array.isArray(nm)) {
    const o = nm as Record<string, unknown>;
    const es = label(o["label_es"]);
    const en = label(o["label_en"]);
    if (!es && !en) return { reason: "bad_label" };
    let maxAbs: number | null = null;
    if (!blank(o["max_abs"])) {
      const n = Number(o["max_abs"]);
      if (!Number.isFinite(n) || n <= 0 || n > 99) return { reason: "bad_value" };
      maxAbs = n;
    }
    material = { label_es: (es ?? en) as string, label_en: (en ?? es) as string, max_abs: maxAbs };
  } else {
    const code = typeof body["material_code"] === "string" ? body["material_code"].trim() : "";
    if (!code || code.length > 60) return { reason: "bad_material" };
    material = { code };
  }
  const finish = blank(body["finish"]) ? (category === "prog" ? "digital" : "stock") : parseLensFinish(body["finish"]);
  if (!finish) return { reason: "bad_value" };
  if (category === "prog" && finish !== "digital") return { reason: "finish_unavailable" };
  const price = moneyCents(body["price"]);
  if (price === undefined || price === null) return { reason: "bad_value" };
  const cost = moneyCents(body["cost"]);
  if (cost === undefined) return { reason: "bad_value" };
  return { cell: { material, finish, price_cents: price, cost_cents: cost } };
}
