/**
 * «VITRINA DE LA TIENDA WEB» (owner, 20-nov-2026): which brands the web shop
 * shows first as its example frames — the home «Los más vendidos» row and the
 * catalogue's default order («Relevancia»). Before this, both were simply the
 * catalogue's database order, so they always opened with the supplier's first
 * collection (Di Caprio).
 *
 *   - `catalog` — as before: the catalogue order, nothing moves;
 *   - `brands`  — the chosen brands first, in the owner's order and taking
 *                 turns (one of each, then the next of each…), then the rest;
 *   - `random`  — a random mix taking turns between brands (the chosen ones,
 *                 or every brand when none is chosen), different on each
 *                 visit, then the rest.
 *
 * Only the ORDER changes: no frame is hidden and no price is touched. The
 * ordering itself runs in the browser (apps/capri-storefront/src/data/
 * showcase.js) because the random mix is per visit. Pure.
 */

export const SHOWCASE_MODES = ["catalog", "brands", "random"] as const;
export type ShowcaseMode = (typeof SHOWCASE_MODES)[number];
export const MAX_SHOWCASE_BRANDS = 20;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface WebShowcase {
  mode: ShowcaseMode;
  /** brand_slug values, in the owner's order. Empty with `random` = every brand. */
  brands: string[];
}

export const DEFAULT_SHOWCASE: WebShowcase = Object.freeze({ mode: "catalog", brands: [] }) as WebShowcase;

export type ShowcaseResult = { ok: true; value: WebShowcase } | { ok: false; reason: string };

/**
 * Validates what the panel sends. Rejects instead of trimming (CLAUDE.md
 * «Validación de campos»): an unknown mode, a slug that is not a slug, more
 * than MAX_SHOWCASE_BRANDS, or `brands` mode with none. Duplicates collapse.
 * `known` (the catalogue's frame brands) turns a slug that is not one into
 * `unknown_brand`.
 */
export function cleanShowcase(body: unknown, known?: ReadonlySet<string>): ShowcaseResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const mode = String(b.mode ?? "");
  if (!(SHOWCASE_MODES as readonly string[]).includes(mode)) return { ok: false, reason: "bad_mode" };
  const raw = b.brands ?? [];
  if (!Array.isArray(raw)) return { ok: false, reason: "bad_brands" };
  const brands: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !SLUG_RE.test(v)) return { ok: false, reason: "bad_brands" };
    if (!brands.includes(v)) brands.push(v);
  }
  if (brands.length > MAX_SHOWCASE_BRANDS) return { ok: false, reason: "too_many_brands" };
  if (known && brands.some((s) => !known.has(s))) return { ok: false, reason: "unknown_brand" };
  if (mode === "brands" && !brands.length) return { ok: false, reason: "brands_required" };
  // `catalog` keeps no brand list: there is nothing it would mean.
  return { ok: true, value: { mode: mode as ShowcaseMode, brands: mode === "catalog" ? [] : brands } };
}

/** A stored row (or nothing) as the showcase; anything unreadable is the catalogue order. Pure. */
export function showcaseOf(row: { mode?: unknown; brands?: unknown } | null | undefined): WebShowcase {
  if (!row) return { ...DEFAULT_SHOWCASE, brands: [] };
  const brands = Array.isArray(row.brands) ? row.brands : typeof row.brands === "string" ? safeJson(row.brands) : [];
  const res = cleanShowcase({ mode: row.mode, brands });
  return res.ok ? res.value : { ...DEFAULT_SHOWCASE, brands: [] };
}

function safeJson(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
