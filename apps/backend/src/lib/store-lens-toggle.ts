import { defaultLensFinish, type LensFinish } from "./lens-finish";
import { lensArKey, lensBaseKey, lensPhotoKey } from "./pricing-overview";

/**
 * Pure semantics for per-store visibility of lens types (designs), lens cells
 * (design × material × finish), and treatments (photochromics × category, ARs).
 *
 * Applies to EVERY store — physical stores (POS) AND the online store (`kind =
 * 'online'`). Costs never change: this only controls whether an option is
 * offered and quotable in a given store.
 *
 * Opt-out by default (absence = enabled), keeping existing global switches
 * (`lens_base_price.is_active`, etc.) intact above these rules:
 *
 *   Lens cell (design, material, finish):
 *     1. own row  ('lens', lensBaseKey(...))
 *     2. design   ('design', design_code)
 *     3. default  true
 *
 *   Photochromic (code, category):
 *     1. own row  ('photo', `${code}:${category}`)
 *     2. group    ('treatment_group', 'photo')
 *     3. default  true
 *
 *   Anti-reflective (code):
 *     1. own row  ('ar', code)
 *     2. group    ('treatment_group', 'ar')
 *     3. default  true
 */

export const STORE_LENS_TOGGLE_KINDS = ["design", "lens", "photo", "ar", "treatment_group"] as const;
export type StoreLensToggleKind = (typeof STORE_LENS_TOGGLE_KINDS)[number];

export interface StoreLensToggleRow {
  establishment_id: string;
  item_kind: StoreLensToggleKind;
  item_key: string;
  enabled: boolean;
}

export type StoreToggleLookup = ReadonlyMap<string, boolean>;

export const toggleLookupKey = (kind: StoreLensToggleKind, key: string): string => `${kind}|${key}`;

/** Index one store's toggle rows for O(1) lookup. Pure. */
export function indexOneStoreToggles(rows: readonly StoreLensToggleRow[] | null | undefined): StoreToggleLookup {
  const m = new Map<string, boolean>();
  if (!rows?.length) return m;
  for (const r of rows) m.set(toggleLookupKey(r.item_kind, r.item_key), Boolean(r.enabled));
  return m;
}

/** Index toggle rows of multiple stores by `establishment_id`. Pure. */
export function indexStoreLensToggles(rows: readonly StoreLensToggleRow[] | null | undefined): Map<string, StoreToggleLookup> {
  const byStore = new Map<string, Map<string, boolean>>();
  if (!rows?.length) return byStore;
  for (const r of rows) {
    let m = byStore.get(r.establishment_id);
    if (!m) {
      m = new Map<string, boolean>();
      byStore.set(r.establishment_id, m);
    }
    m.set(toggleLookupKey(r.item_kind, r.item_key), Boolean(r.enabled));
  }
  return byStore;
}

export function designToggleRule(toggles: StoreToggleLookup | null | undefined, designCode: string): boolean | null {
  if (!toggles?.size) return null;
  const v = toggles.get(toggleLookupKey("design", designCode));
  return v === undefined ? null : v;
}

export function isDesignEnabled(toggles: StoreToggleLookup | null | undefined, designCode: string): boolean {
  return designToggleRule(toggles, designCode) !== false;
}

export function isLensCellEnabled(
  toggles: StoreToggleLookup | null | undefined,
  designCode: string,
  materialCode: string,
  finish: LensFinish | null | undefined,
  category: string | null | undefined
): boolean {
  if (!toggles?.size) return true;
  const key = lensBaseKey(designCode, materialCode, finish ?? defaultLensFinish(category), category);
  const own = toggles.get(toggleLookupKey("lens", key));
  if (own !== undefined) return own;
  const designRule = toggles.get(toggleLookupKey("design", designCode));
  return designRule !== undefined ? designRule : true;
}

export function isLensKeyEnabled(toggles: StoreToggleLookup | null | undefined, designCode: string, key: string): boolean {
  if (!toggles?.size) return true;
  const own = toggles.get(toggleLookupKey("lens", key));
  if (own !== undefined) return own;
  const designRule = toggles.get(toggleLookupKey("design", designCode));
  return designRule !== undefined ? designRule : true;
}

export function treatmentGroupToggleRule(toggles: StoreToggleLookup | null | undefined, group: "photo" | "ar"): boolean | null {
  if (!toggles?.size) return null;
  const v = toggles.get(toggleLookupKey("treatment_group", group));
  return v === undefined ? null : v;
}

export function isPhotoEnabled(toggles: StoreToggleLookup | null | undefined, code: string, category: string): boolean {
  if (!toggles?.size) return true;
  const own = toggles.get(toggleLookupKey("photo", lensPhotoKey(code, category)));
  if (own !== undefined) return own;
  const grp = toggles.get(toggleLookupKey("treatment_group", "photo"));
  return grp !== undefined ? grp : true;
}

export function isArEnabled(toggles: StoreToggleLookup | null | undefined, code: string): boolean {
  if (!toggles?.size) return true;
  const own = toggles.get(toggleLookupKey("ar", lensArKey(code)));
  if (own !== undefined) return own;
  const grp = toggles.get(toggleLookupKey("treatment_group", "ar"));
  return grp !== undefined ? grp : true;
}

/** Validate a toggle write request; returns a reason code or null when valid. Pure. */
export function storeLensToggleDenied(input: { store?: unknown; kind?: unknown; key?: unknown; enabled?: unknown }): string | null {
  if (typeof input.store !== "string" || !input.store.trim()) return "store_required";
  if (typeof input.kind !== "string" || !STORE_LENS_TOGGLE_KINDS.includes(input.kind as StoreLensToggleKind)) return "bad_kind";
  if (typeof input.key !== "string" || !input.key.trim() || input.key.trim().length > 120) return "bad_key";
  if (input.kind === "treatment_group" && input.key.trim() !== "photo" && input.key.trim() !== "ar") return "bad_key";
  if (typeof input.enabled !== "boolean") return "bad_value";
  return null;
}

export interface LensMatrixLike {
  designs: Record<string, unknown>[];
  materials: Record<string, unknown>[];
  base_prices: Array<{ design_code: string; material_code: string; finish?: LensFinish; price_cents: number; hidden?: true }>;
  photos: Record<string, unknown>[];
  ars: Record<string, unknown>[];
  treatment_prices: Record<string, unknown>[];
}

const PHOTO_PRICE_COLUMNS: ReadonlyArray<[column: string, category: string]> = [
  ["price_sv_cents", "sv"],
  ["price_bifocal_cents", "bifocal"],
  ["price_prog_cents", "prog"],
];

/**
 * Filters a store's lens matrix according to its per-store toggles.
 * - Drops disabled `base_prices` cells.
 * - Drops `designs` that have no surviving `base_prices` cells.
 * - Nulls out disabled categories on `photos` (and drops a photo option if all
 *   its categories are disabled/null).
 * - Drops disabled `ars`.
 * - Drops `treatment_prices` rows whose AR is disabled or where no photo is
 *   enabled for that design's category.
 *
 * A store with no toggles gets the exact same object back. Pure.
 */
export function applyStoreLensToggles<T extends LensMatrixLike>(matrix: T, toggles: StoreToggleLookup | null | undefined): T {
  if (!toggles?.size) return matrix;

  const categoryOf = new Map<string, string>();
  for (const d of matrix.designs) categoryOf.set(String(d["code"] ?? ""), String(d["category"] ?? ""));

  const base_prices = matrix.base_prices.filter((cell) => {
    const category = categoryOf.get(cell.design_code) ?? null;
    const finish = cell.finish ?? defaultLensFinish(category);
    return isLensCellEnabled(toggles, cell.design_code, cell.material_code, finish, category);
  });

  const liveDesigns = new Set(base_prices.map((c) => c.design_code));
  const designs = matrix.designs.filter((d) => liveDesigns.has(String(d["code"] ?? "")));

  const enabledPhotoCats = new Set<string>();
  const photos: Record<string, unknown>[] = [];
  for (const p of matrix.photos) {
    const code = String(p["code"] ?? "");
    const next: Record<string, unknown> = { ...p };
    let any = false;
    for (const [col, cat] of PHOTO_PRICE_COLUMNS) {
      if (next[col] == null) continue;
      if (!isPhotoEnabled(toggles, code, cat)) {
        next[col] = null;
      } else {
        any = true;
        enabledPhotoCats.add(cat);
      }
    }
    if (any) photos.push(next);
  }

  const ars = matrix.ars.filter((a) => isArEnabled(toggles, String(a["code"] ?? "")));
  const liveArs = new Set(ars.map((a) => String(a["code"] ?? "")));

  const treatment_prices = matrix.treatment_prices.filter((tp) => {
    const designCode = String(tp["design_code"] ?? "");
    if (!liveDesigns.has(designCode)) return false;
    const treat = String(tp["treatment_code"] ?? "");
    if (treat === "photo") {
      const cat = categoryOf.get(designCode) ?? "";
      return enabledPhotoCats.has(cat);
    }
    if (treat === "ar-green" || treat === "ar-blue") return liveArs.has(treat);
    return true;
  });

  return { ...matrix, designs, base_prices, photos, ars, treatment_prices };
}
