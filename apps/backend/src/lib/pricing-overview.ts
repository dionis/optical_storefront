import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";
import { listCostRules, profitTargetPct, type CostRule } from "./costing";
import { listEstablishments } from "./establishments";
import { listSellers } from "./sellers";
import { resolveStoreSettings } from "./store-settings";
import { disabledIds, loadCostToggles, loadDefaultCommissionPct } from "./store-cost-toggle";
import { brandOf } from "./store-assortment";
import { defaultLensFinish, LENS_FINISHES, parseLensFinish, type LensFinish } from "./lens-finish";
import { brandOfTarget, isActiveAt, type PriceRuleLike } from "./store-pricing";
import { openRules, productPrices, type PriceRuleRow } from "./store-pricing-data";
import { STORE_COST_MODULE } from "../modules/store-cost";
import type StoreCostModuleService from "../modules/store-cost/service";

/**
 * ONE payload for the pricing panel ("Precios y costos"), and the pure rules
 * that make a store's own lens prices actually apply.
 *
 * The owner's requirement, in his words: "everything about cost and price
 * management and profit in ONE panel for the superadmin, including the price
 * per store … each store manages its own prices separately — not by uploading
 * files, but from that single master, with variations per store".
 *
 * So there are exactly two reading modes:
 *   store = null  → THE MASTER: the owner's list (lens-config tables, the
 *                   global price rules with establishment_id null, the cost
 *                   rules, the commissions, the tax rate).
 *   store = <id>  → the master AND that store's variation side by side, so the
 *                   panel can badge every inherited value "Heredado del maestro".
 *
 * Precedence, in one place so the panel, the point of sale and the Google
 * Sheet cannot disagree:
 *
 *   FRAMES / CASES   store exact price  >  store rule  >  master rule
 *                    >  owner's global price (override)  >  Medusa variant price
 *   LENSES           store cell override  >  store "% over the master"
 *                    >  master matrix cell
 *
 * Amounts: frames in dollars (the price rules' unit), lenses in cents (the
 * lens-config tables' unit). Each function says which it speaks.
 */

// ── Per-store lens prices ────────────────────────────────────────────────────

export const LENS_STORE_KINDS = ["adjust", "base", "photo", "ar"] as const;
export type LensStoreKind = (typeof LENS_STORE_KINDS)[number];

export interface LensStorePriceLike {
  establishment_id: string;
  item_kind: string;
  item_key: string;
  value: number;
}

export interface LensStorePriceRow extends LensStorePriceLike {
  id: string;
  created_by: string | null;
}

/**
 * The `item_key` of each kind of cell, so every writer spells it the same.
 *
 * A base cell's key is "<design>:<material>" for a STOCK cell and
 * "<design>:<material>:digital" for a surfaced one. The stock spelling is the
 * one every row written before finishes existed already carries, so those
 * variations keep applying. A progressive's single cell is digital by nature
 * but keeps the short key ("prog-mid:cr39"): it was written that way and the
 * panel never shows a stock column for it — `lensBaseKey(design, material,
 * finish, category)` makes that choice so no caller has to.
 */
export const lensBaseKey = (
  designCode: string,
  materialCode: string,
  finish: LensFinish = "stock",
  category: string | null = null
): string => {
  const base = `${designCode}:${materialCode}`;
  return finish === "digital" && defaultLensFinish(category) !== "digital" ? `${base}:digital` : base;
};
/** Splits a base key back into its parts; null when it is not one. */
export function parseLensBaseKey(key: string): { design_code: string; material_code: string; finish: LensFinish } | null {
  const [design_code, material_code, rest, ...more] = key.split(":");
  if (!design_code || !material_code || more.length) return null;
  if (rest === undefined) return { design_code, material_code, finish: "stock" };
  const finish = parseLensFinish(rest);
  return finish ? { design_code, material_code, finish } : null;
}
export const lensPhotoKey = (code: string, category: string): string => `${code}:${category}`;
export const lensArKey = (code: string): string => code;
export const LENS_ADJUST_KEY = "all";

const roundCents = (v: number): number => Math.max(0, Math.round(v));

/**
 * What a store charges for one lens cell. PURE — this is the function the point
 * of sale needs, and the one the tests pin.
 *
 *  - an exact override of that cell wins outright (the owner typed a price);
 *  - otherwise the store's single "% over the master" applies;
 *  - otherwise the master price, untouched.
 *
 * `masterCents` and the result are USD cents. A kind of "adjust" has no cell,
 * so it only ever returns the master (asking for it is a caller's mistake, not
 * an error worth throwing over).
 */
export function applyStoreLensPrice(
  masterCents: number,
  storeRows: LensStorePriceLike[],
  target: { kind: LensStoreKind; key: string }
): number {
  const master = roundCents(Number(masterCents) || 0);
  if (!storeRows?.length) return master;
  if (target.kind !== "adjust") {
    const cell = storeRows.find((r) => r.item_kind === target.kind && r.item_key === target.key);
    if (cell) return roundCents(Number(cell.value));
  }
  const adjust = storeRows.find((r) => r.item_kind === "adjust" && r.item_key === LENS_ADJUST_KEY);
  if (!adjust) return master;
  const pct = Number(adjust.value);
  if (!Number.isFinite(pct)) return master;
  return roundCents(master * (1 + pct / 100));
}

/** The store's "% over the master", or null when it has none. */
export function storeLensAdjustPct(storeRows: LensStorePriceLike[]): number | null {
  const row = storeRows?.find((r) => r.item_kind === "adjust" && r.item_key === LENS_ADJUST_KEY);
  if (!row) return null;
  const pct = Number(row.value);
  return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null;
}

export interface LensBreakdownLike {
  lens_base_cents: number;
  photo_cents: number;
  ar_cents: number;
  total_cents: number;
  category: string | null;
  /** Which base cell was quoted (lib/lens-finish.ts); absent on older callers = the design's default. */
  finish?: LensFinish | null;
}

export interface LensSelectionLike {
  design_code: string;
  material_code?: string | null;
  photo_code?: string | null;
  ar_code?: string | null;
}

/**
 * The same breakdown with a store's variation applied to each component. PURE,
 * and the ONE line lib/lens-quote.ts needs (see the reported change): the base,
 * the photochromic and the AR each resolve on their own, so a store can put an
 * exact price on just one cell and let the percentage cover the rest.
 */
export function applyStoreLensBreakdown<T extends LensBreakdownLike>(
  breakdown: T,
  storeRows: LensStorePriceLike[],
  selection: LensSelectionLike
): T {
  if (!storeRows?.length) return breakdown;
  const category = breakdown.category ?? "";
  const lens_base_cents = selection.material_code
    ? applyStoreLensPrice(breakdown.lens_base_cents, storeRows, {
        kind: "base",
        key: lensBaseKey(selection.design_code, selection.material_code, breakdown.finish ?? defaultLensFinish(category), category),
      })
    : breakdown.lens_base_cents;
  const photo_cents =
    selection.photo_code && breakdown.photo_cents > 0
      ? applyStoreLensPrice(breakdown.photo_cents, storeRows, {
          kind: "photo",
          key: lensPhotoKey(selection.photo_code, category),
        })
      : breakdown.photo_cents;
  const ar_cents =
    selection.ar_code && breakdown.ar_cents > 0
      ? applyStoreLensPrice(breakdown.ar_cents, storeRows, { kind: "ar", key: lensArKey(selection.ar_code) })
      : breakdown.ar_cents;
  return {
    ...breakdown,
    lens_base_cents,
    photo_cents,
    ar_cents,
    total_cents: lens_base_cents + photo_cents + ar_cents,
  };
}

/** Validation of one lens-price write; a `reason` code or null. */
export function lensPriceDenied(kind: unknown, key: unknown, value: unknown): string | null {
  if (typeof kind !== "string" || !(LENS_STORE_KINDS as readonly string[]).includes(kind)) return "bad_kind";
  if (typeof key !== "string" || !key.trim() || key.length > 120) return "bad_key";
  if (kind === "base" && !parseLensBaseKey(key)) return "bad_key";
  if (kind === "adjust") {
    if (key !== LENS_ADJUST_KEY) return "bad_key";
    if (value === null) return null;
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < -90 || pct > 500) return "bad_value";
    return null;
  }
  if (value === null) return null;
  const n = Number(value);
  // Cells are typed in DOLLARS by the panel and stored in cents by the route.
  if (!Number.isFinite(n) || n < 0 || n > 100000) return "bad_value";
  return null;
}

const lensSvc = (c: MedusaContainer) => c.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);

function toLensRow(r: Record<string, unknown>): LensStorePriceRow {
  return {
    id: String(r["id"]),
    establishment_id: String(r["establishment_id"] ?? ""),
    item_kind: String(r["item_kind"] ?? ""),
    item_key: String(r["item_key"] ?? ""),
    value: Number(r["value"]),
    created_by: (r["created_by"] as string | null) ?? null,
  };
}

/**
 * A store's lens variations. Never throws: a store with no rows (or an
 * un-migrated table) quotes the master, which is what the shop did before.
 */
export async function loadStoreLensPrices(
  container: MedusaContainer,
  establishmentId: string | null | undefined
): Promise<LensStorePriceRow[]> {
  if (!establishmentId) return [];
  try {
    const rows = (await lensSvc(container).listLensStorePrices(
      { establishment_id: establishmentId } as never,
      { take: 2000 }
    )) as unknown as Record<string, unknown>[];
    return rows.filter((r) => !r["deleted_at"]).map(toLensRow);
  } catch {
    return [];
  }
}

/**
 * Create / update / remove one lens variation of a store. `value` null removes
 * it (the cell goes back to inheriting). Cells are stored in CENTS, the
 * percentage as a percentage.
 */
export async function upsertStoreLensPrice(
  container: MedusaContainer,
  input: { establishmentId: string; kind: LensStoreKind; key: string; value: number | null },
  actorId: string | null
): Promise<LensStorePriceRow | null> {
  const service = lensSvc(container);
  const rows = (await service.listLensStorePrices(
    { establishment_id: input.establishmentId, item_kind: input.kind, item_key: input.key } as never,
    { take: 1 }
  )) as unknown as Record<string, unknown>[];
  const current = rows.find((r) => !r["deleted_at"]);
  if (input.value === null) {
    if (current) await service.deleteLensStorePrices([String(current["id"])]);
    return null;
  }
  const value = input.kind === "adjust" ? Math.round(input.value * 100) / 100 : roundCents(input.value);
  if (current) {
    const [updated] = (await service.updateLensStorePrices([
      { id: current["id"], value },
    ] as never)) as unknown as Record<string, unknown>[];
    return toLensRow(updated ?? { ...current, value });
  }
  const created = (await service.createLensStorePrices({
    establishment_id: input.establishmentId,
    item_kind: input.kind,
    item_key: input.key,
    value,
    created_by: actorId,
  } as never)) as unknown as Record<string, unknown>;
  return toLensRow(created);
}

// ── Frame / case rules ───────────────────────────────────────────────────────

const toMs = (v: string | Date) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/**
 * The rule that covers EVERY frame (or every case) of a store, or of the master
 * when `establishmentId` is null: scope "frame"/"case" with no target, or the
 * older scope "all" which covers both. Latest active one wins.
 */
export function frameRuleOf(
  rules: PriceRuleLike[],
  establishmentId: string | null,
  scope: "frame" | "case",
  now = new Date()
): PriceRuleLike | null {
  let best: PriceRuleLike | null = null;
  for (const r of rules) {
    if (r.establishment_id !== establishmentId) continue;
    if (r.mode !== "percent" && r.mode !== "delta") continue;
    if (r.target != null) continue;
    if (r.scope !== scope && r.scope !== "all") continue;
    if (!isActiveAt(r, now)) continue;
    // A scope-specific rule always beats the catch-all "all".
    if (!best) best = r;
    else if (best.scope === "all" && r.scope === scope) best = r;
    else if (best.scope === r.scope && toMs(r.valid_from) >= toMs(best.valid_from)) best = r;
  }
  return best;
}

export interface FrameRuleView {
  scope: "frame" | "case" | "all";
  mode: "percent" | "delta";
  value: number;
  since: string | null;
  /** True when it comes from the master because the store has none of its own. */
  inherited: boolean;
}

function frameRuleView(
  rules: PriceRuleRow[],
  storeId: string | null,
  scope: "frame" | "case",
  now: Date
): FrameRuleView | null {
  const own = storeId ? frameRuleOf(rules, storeId, scope, now) : null;
  const master = frameRuleOf(rules, null, scope, now);
  const pick = own ?? master;
  if (!pick) return null;
  return {
    scope: pick.scope as "frame" | "case" | "all",
    mode: pick.mode as "percent" | "delta",
    value: Number(pick.value),
    since: pick.valid_from ? new Date(pick.valid_from).toISOString() : null,
    inherited: !own,
  };
}

export interface FrameOverrideView {
  product_id: string;
  variant_id: string | null;
  title: string;
  brand: string;
  sku: string;
  kind: "frame" | "case";
  /** Medusa price of the model before any rule, in dollars; null when it has none. */
  base: number | null;
  /** What this store (or the master) charges, in dollars. */
  price: number;
  since: string | null;
  by: string | null;
  /** True when the row is the master's and the store did not change it. */
  inherited: boolean;
}

// ── The whole payload ────────────────────────────────────────────────────────

export interface PricingOverview {
  store: { id: string; code: string; name: string } | null;
  frames: {
    rule: FrameRuleView | null;
    case_rule: FrameRuleView | null;
    overrides: FrameOverrideView[];
    counts: { frames: number; cases: number };
  };
  lenses: {
    designs: Array<Record<string, unknown>>;
    materials: Array<Record<string, unknown>>;
    /**
     * One row per priced cell: (design, material, finish). `cost_cents` is the
     * lab's cost and is present ONLY for a reader with cost privileges
     * (`redactLensCosts`); a plain reader never receives the key.
     */
    base: LensBaseCellView[];
    /** Whether this payload carries `cost_cents` (the panel shows the cost row only then). */
    cost_access: boolean;
    photo: Array<{ code: string; label_es: string; label_en: string; colors: string[]; sv: number | null; bifocal: number | null; prog: number | null; store: Record<string, number> }>;
    ar: Array<{ code: string; label_es: string; label_en: string; ar_group: string; cents: number; store_cents: number | null }>;
    store: { adjust_pct: number | null; cells: Array<{ kind: string; key: string; value: number }> } | null;
  };
  commissions: {
    default_pct: number | null;
    sellers: Array<{ id: string; code: string; name: string; pct: number; active: boolean }>;
  };
  costs: {
    rules: Array<{ id: string; kind: string; match_key: string; label: string; value: number; unit: string; enabled: boolean; group: string }>;
    fixed: Array<Record<string, unknown>>;
    variable: Array<Record<string, unknown>>;
    taxes: { rate_pct: number; source: string };
    profit_target_pct: number | null;
  };
}

export interface LensBaseCellView {
  design_code: string;
  material_code: string;
  finish: LensFinish;
  /** Master price of the cell. */
  cents: number;
  /** What the open store charges (its own cell, or its % over the master); null when reading the master. */
  store_cents: number | null;
  /** Lab cost of the cell (master only; null = unknown). Stripped for readers without cost privileges. */
  cost_cents?: number | null;
}

/**
 * The lens half of the payload as a reader WITHOUT cost privileges may see it:
 * `cost_cents` removed from every cell and `cost_access` false. Done on the
 * server, never by hiding a column in the browser (same rule as
 * `redactInsights` in lib/sales-insights.ts). Pure.
 */
export function redactLensCosts<T extends { base: LensBaseCellView[]; cost_access: boolean }>(lenses: T, canSeeCosts: boolean): T {
  if (canSeeCosts) return { ...lenses, cost_access: true };
  return {
    ...lenses,
    cost_access: false,
    base: lenses.base.map((cell) => {
      const { cost_cents: _cost, ...rest } = cell;
      return rest;
    }),
  };
}

/** Which accordion a cost rule belongs to, so the panel never groups by hand. */
export function costGroupOf(kind: string): string {
  if (kind === "frame_brand" || kind === "frame_sku") return "frames";
  if (kind.startsWith("lens_")) return "lenses";
  if (kind === "order_percent") return "percent";
  return "order";
}

const money2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The panel's single read. One round of queries, everything degrading to the
 * master rather than failing: a pricing screen that cannot open is a shop that
 * cannot answer "how much is this?".
 */
export async function loadPricingOverview(
  container: MedusaContainer,
  storeId: string | null
): Promise<PricingOverview> {
  const now = new Date();
  const stores = await listEstablishments(container);
  const store = storeId ? stores.find((s) => s.id === storeId) ?? null : null;
  const effectiveStore = store ? store.id : null;

  const [rules, lensMatrix, storeLens, costRules, toggles, sellers, defaultPct, settings, costItems] = await Promise.all([
    openRules(container, effectiveStore ? [effectiveStore] : []),
    lensSvc(container)
      .getMatrix()
      .catch(() => ({ designs: [], materials: [], base_prices: [], photos: [], ars: [] })),
    loadStoreLensPrices(container, effectiveStore),
    listCostRules(container).catch(() => [] as CostRule[]),
    loadCostToggles(container, effectiveStore),
    listSellers(container).catch(() => []),
    loadDefaultCommissionPct(container),
    resolveStoreSettings(container),
    loadCostItems(container, effectiveStore),
  ]);

  // ── Frames and cases ──
  // A brand price (`brand:<slug>`, v2) is not a model's price: the matrix shows it in the brand header.
  const liveOverrides = rules.filter((r) => r.mode === "override" && r.target && !brandOfTarget(r.target) && isActiveAt(r, now));
  const masterById = new Map<string, PriceRuleRow>();
  const storeById = new Map<string, PriceRuleRow>();
  for (const r of liveOverrides) {
    const bucket = r.establishment_id == null ? masterById : r.establishment_id === effectiveStore ? storeById : null;
    if (!bucket) continue;
    const prev = bucket.get(r.target as string);
    if (!prev || toMs(r.valid_from) >= toMs(prev.valid_from)) bucket.set(r.target as string, r);
  }
  // With a store open the panel shows ITS list; "Todas las tiendas" shows the master's.
  const shown = effectiveStore ? new Map([...masterById, ...storeById]) : masterById;
  const ids = [...shown.keys()];
  const [prices, brands] = await Promise.all([productPrices(container, ids), loadBrands(container, ids)]);
  const products = new Map(prices.map((p) => [p.product_id, p]));
  const overrides: FrameOverrideView[] = [...shown.entries()].map(([productId, rule]) => {
    const own = storeById.get(productId);
    const product = products.get(productId);
    return {
      product_id: productId,
      variant_id: null,
      title: product?.title ?? productId,
      brand: brands.get(productId) ?? "",
      sku: product?.handle ?? "",
      kind: rule.scope === "case" ? "case" : "frame",
      base: product?.price ?? null,
      price: money2(Number(rule.value)),
      since: rule.valid_from ? new Date(rule.valid_from).toISOString() : null,
      by: rule.created_by ?? null,
      inherited: Boolean(effectiveStore) && !own,
    };
  });
  overrides.sort((a, b) => a.title.localeCompare(b.title));

  // ── Lenses ──
  const designs = lensMatrix.designs as Array<Record<string, unknown>>;
  const materials = lensMatrix.materials as Array<Record<string, unknown>>;
  const categoryOf = new Map(designs.map((d) => [String(d["code"]), String(d["category"] ?? "")]));
  const base: LensBaseCellView[] = (lensMatrix.base_prices as Array<Record<string, unknown>>).map((c) => {
    const design_code = String(c["design_code"]);
    const material_code = String(c["material_code"]);
    const category = categoryOf.get(design_code) ?? null;
    // A row from a database without the finish column is the design's only cell.
    const finish = parseLensFinish(c["finish"]) ?? defaultLensFinish(category);
    const cents = Number(c["price_cents"]) || 0;
    const key = lensBaseKey(design_code, material_code, finish, category);
    const resolved = applyStoreLensPrice(cents, storeLens, { kind: "base", key });
    const cost = c["cost_cents"];
    return {
      design_code,
      material_code,
      finish,
      cents,
      store_cents: effectiveStore ? resolved : null,
      cost_cents: cost == null || cost === "" ? null : Math.round(Number(cost)) || 0,
    };
  });
  base.sort((a, b) => a.design_code.localeCompare(b.design_code) || a.material_code.localeCompare(b.material_code) || LENS_FINISHES.indexOf(a.finish) - LENS_FINISHES.indexOf(b.finish));
  const photo = (lensMatrix.photos as Array<Record<string, unknown>>).map((p) => {
    const code = String(p["code"]);
    const perCat: Record<string, number | null> = {
      sv: p["price_sv_cents"] == null ? null : Number(p["price_sv_cents"]),
      bifocal: p["price_bifocal_cents"] == null ? null : Number(p["price_bifocal_cents"]),
      prog: p["price_prog_cents"] == null ? null : Number(p["price_prog_cents"]),
    };
    const storeCells: Record<string, number> = {};
    if (effectiveStore) {
      for (const cat of ["sv", "bifocal", "prog"]) {
        const master = perCat[cat];
        if (master == null) continue;
        storeCells[cat] = applyStoreLensPrice(master, storeLens, { kind: "photo", key: lensPhotoKey(code, cat) });
      }
    }
    return {
      code,
      label_es: String(p["label_es"] ?? ""),
      label_en: String(p["label_en"] ?? ""),
      colors: (p["colors"] as string[]) ?? [],
      sv: perCat.sv,
      bifocal: perCat.bifocal,
      prog: perCat.prog,
      store: storeCells,
    };
  });
  const ar = (lensMatrix.ars as Array<Record<string, unknown>>).map((a) => {
    const code = String(a["code"]);
    const cents = Number(a["price_cents"]) || 0;
    return {
      code,
      label_es: String(a["label_es"] ?? ""),
      label_en: String(a["label_en"] ?? ""),
      ar_group: String(a["ar_group"] ?? "all"),
      cents,
      store_cents: effectiveStore ? applyStoreLensPrice(cents, storeLens, { kind: "ar", key: lensArKey(code) }) : null,
    };
  });

  // ── Costs ──
  const off = new Set(disabledIds(effectiveStore, toggles, "rule"));
  const offCosts = new Set(disabledIds(effectiveStore, toggles, "cost"));
  const costRuleViews = costRules
    .filter((r) => !(r.kind === "order_percent" && r.match_key === "profit_target"))
    .map((r) => {
      const id = r.id ?? `${r.kind}:${r.match_key}`;
      return {
        id,
        kind: r.kind,
        match_key: r.match_key,
        label: r.label,
        value: r.amount,
        unit: r.unit,
        enabled: r.active && !off.has(id) && !off.has(`${r.kind}:${r.match_key}`),
        group: costGroupOf(r.kind),
      };
    });

  return {
    store: store ? { id: store.id, code: String(store.code ?? ""), name: String(store.name ?? "") } : null,
    frames: {
      rule: frameRuleView(rules, effectiveStore, "frame", now),
      case_rule: frameRuleView(rules, effectiveStore, "case", now),
      overrides,
      counts: {
        frames: overrides.filter((o) => o.kind === "frame").length,
        cases: overrides.filter((o) => o.kind === "case").length,
      },
    },
    lenses: {
      designs,
      materials,
      base,
      // The loader answers the full master; the route redacts per reader.
      cost_access: true,
      photo,
      ar,
      store: effectiveStore
        ? {
            adjust_pct: storeLensAdjustPct(storeLens),
            cells: storeLens
              .filter((r) => r.item_kind !== "adjust")
              .map((r) => ({ kind: r.item_kind, key: r.item_key, value: r.value })),
          }
        : null,
    },
    commissions: {
      default_pct: defaultPct,
      sellers: sellers.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        pct: Number(s.commission_pct) || 0,
        active: s.active !== false,
      })),
    },
    costs: {
      rules: costRuleViews,
      fixed: costItems.filter((c) => c["kind"] === "fixed").map((c) => ({ ...c, enabled: !offCosts.has(String(c["id"])) })),
      variable: costItems.filter((c) => c["kind"] === "variable").map((c) => ({ ...c, enabled: !offCosts.has(String(c["id"])) })),
      taxes: { rate_pct: Math.round(settings.frame_tax_rate * 10000) / 100, source: settings.source },
      profit_target_pct: profitTargetPct(costRules),
    },
  };
}

/** Brand slug of each product, for the "Modificados" table; empty on any failure. */
async function loadBrands(container: MedusaContainer, productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!productIds.length) return out;
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({ entity: "product", fields: ["id", "metadata"], filters: { id: productIds } });
    for (const p of (data ?? []) as Array<{ id: string; metadata?: Record<string, unknown> | null }>) {
      out.set(String(p.id), brandOf(p.metadata ?? null));
    }
  } catch {
    return out;
  }
  return out;
}

/** The store's own cost items plus the shared ones; empty on any failure. */
async function loadCostItems(
  container: MedusaContainer,
  establishmentId: string | null
): Promise<Array<Record<string, unknown>>> {
  try {
    const rows = (await container
      .resolve<StoreCostModuleService>(STORE_COST_MODULE)
      .listCostItems({}, { take: 2000, order: { starts_on: "DESC" } })) as unknown as Record<string, unknown>[];
    return rows
      .filter((r) => !r["deleted_at"])
      .filter((r) => (establishmentId ? r["establishment_id"] === establishmentId || r["establishment_id"] == null : true))
      .map((r) => ({
        id: String(r["id"]),
        establishment_id: (r["establishment_id"] as string | null) ?? null,
        kind: String(r["kind"]),
        category: String(r["category"] ?? ""),
        description: (r["description"] as string | null) ?? null,
        amount: Math.round(Number(r["amount_cents"]) || 0) / 100,
        frequency: String(r["frequency"] ?? "monthly"),
        starts_on: String(r["starts_on"] ?? ""),
        ends_on: (r["ends_on"] as string | null) ?? null,
        vendor: (r["vendor"] as string | null) ?? null,
        shared: r["establishment_id"] == null,
      }));
  } catch {
    return [];
  }
}

/**
 * The `store` field of a write: "", "all" and "web" mean the master (null),
 * anything else must be a real establishment. Returns a `reason` code instead
 * of throwing so every route answers the same way.
 */
export async function resolvePricingStore(
  container: MedusaContainer,
  value: unknown
): Promise<{ storeId: string | null } | { reason: "store_not_found" }> {
  const raw = value == null ? "" : String(value).trim();
  if (!raw || raw === "all" || raw === "web") return { storeId: null };
  const known = await listEstablishments(container);
  if (!known.some((e) => e.id === raw)) return { reason: "store_not_found" };
  return { storeId: raw };
}

/**
 * The product a variant belongs to. Prices here are per MODEL, so the panel may
 * send either id and the rule is always stored against the product.
 */
export async function productOfVariant(
  container: MedusaContainer,
  variantId: string
): Promise<string | null> {
  if (!variantId) return null;
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "product_id"],
      filters: { id: variantId },
    });
    const row = (data as Array<{ product_id?: string | null }>)[0];
    return row?.product_id ? String(row.product_id) : null;
  } catch {
    return null;
  }
}

/**
 * A store's lens variations read through the SHARED Postgres connection, for
 * callers that work with Knex rather than the module ORM (lib/lens-quote.ts,
 * which is the one path every quote goes through). Never throws: no rows means
 * the store quotes the master.
 */
export async function loadStoreLensPricesPg(
  pg: Knex,
  establishmentId: string | null | undefined
): Promise<LensStorePriceRow[]> {
  if (!establishmentId) return [];
  try {
    const rows = await pg("lens_store_price").whereNull("deleted_at").where({ establishment_id: establishmentId });
    return (rows as Array<Record<string, unknown>>).map(toLensRow);
  } catch {
    return [];
  }
}
