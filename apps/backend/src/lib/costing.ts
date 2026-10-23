import type { IOrderModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { COSTING_MODULE } from "../modules/costing/index";
import type CostingModuleService from "../modules/costing/service";
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";
import type { BoardOrder } from "./order-board";
import { listSellers } from "./sellers";

/**
 * Ficha de costo por venta — what each order cost the shop, so the panel can
 * show a margin next to the revenue.
 *
 * The owner's rule: "if the customer paid 100, first take out shipping,
 * taxes and the gateway's fee, and THEN distribute the rest". So:
 *
 *   gross        = order.total (what the customer paid)
 *   deductions   = shipping + taxes + payment fee (% of gross) + fixed fee
 *                  — money that passes through, never the shop's
 *   net_base     = gross − deductions (floored at 0)
 *   materials    = frame + lens codes + per-order fixed items
 *   percent      = every `order_percent` rule (except the payment fee and the
 *                  profit target) applied to net_base
 *   commission   = the seller's % of net_base
 *   cost_total   = deductions + materials + percent + commission
 *   margin       = gross − cost_total (the owner's profit)
 *   target       = net_base × profit_target_pct — a goal, never a cost line
 *
 * Two layers:
 *   - RULES (`cost_rule` table): the owner's template. "A Flexure frame costs
 *     me 18", "the lab charges 12 per order", "Stripe keeps 2.9% + 0.30".
 *     Amount 0 means "not defined yet" and the panel highlights it.
 *   - PER ORDER (`order.metadata.cost_sheet`): an optional manual override of
 *     the lines, written by the owner from the panel. Absent → the sheet is
 *     computed live from the rules every time it is read.
 *
 * `computeCostSheet` is pure (tested without a database); the container
 * helpers below load the rules and persist overrides.
 */

// ── Kinds ────────────────────────────────────────────────────────────────────

export const COST_KINDS = [
  "frame_brand",
  "frame_sku",
  "lens_design",
  "lens_material",
  "lens_photo",
  "lens_ar",
  "order_fixed",
  "order_percent",
  "shipping",
  "payment_fixed",
] as const;
export type CostKind = (typeof COST_KINDS)[number];

/** Spanish labels for the by-kind breakdown and seed rows. */
export const KIND_LABEL: Record<CostKind, string> = {
  frame_brand: "Montura (por marca)",
  frame_sku: "Montura (por SKU)",
  lens_design: "Lente (diseño)",
  lens_material: "Lente (material)",
  lens_photo: "Fotocromático",
  lens_ar: "Antirreflejo",
  order_fixed: "Por pedido",
  order_percent: "Porcentaje del pedido",
  shipping: "Envío",
  payment_fixed: "Comisión fija de pago",
};

/** `order_percent` match_key reserved for the seller's commission — never a rule. */
export const SELLER_COMMISSION_KEY = "seller_commission";

/**
 * `order_percent` match_key of the gateway's percentage fee. It is the one
 * percentage computed on the GROSS (the processor takes its cut of what the
 * customer paid), and it is a deduction, not a distribution.
 */
export const PAYMENT_FEE_KEY = "payment_fee";

/**
 * `order_percent` match_key for the owner's target profit ("I want to keep
 * 30 % of every sale"). It is saved like any other percentage so the panel can
 * edit it in the same table, but it is NOT a cost: `computeCostSheet` skips it
 * as a line and reports it as `profit_target_pct` / `profit_target_amount` /
 * `profit_gap` (over the NET base) next to the margin instead.
 */
export const PROFIT_TARGET_KEY = "profit_target";

/** The owner's default target: keep 30 % of the net base of every sale. */
export const DEFAULT_PROFIT_TARGET_PCT = 30;

export function isCostKind(value: unknown): value is CostKind {
  return typeof value === "string" && (COST_KINDS as readonly string[]).includes(value);
}

export function isProfitTargetRule(rule: Pick<CostRule, "kind" | "match_key">): boolean {
  return rule.kind === "order_percent" && normalizeMatchKey("order_percent", rule.match_key) === PROFIT_TARGET_KEY;
}

export function isPaymentFeeRule(rule: Pick<CostRule, "kind" | "match_key">): boolean {
  return rule.kind === "order_percent" && normalizeMatchKey("order_percent", rule.match_key) === PAYMENT_FEE_KEY;
}

/** The active profit-target percentage among the rules; null when none is defined (or it is still 0). */
export function profitTargetPct(rules: CostRule[]): number | null {
  const rule = rules.find((r) => r.active && isProfitTargetRule(r));
  const pct = rule ? round2(num(rule.amount)) : 0;
  return pct > 0 ? pct : null;
}

/** How the target compares with what a sale (or a period) actually left. */
export interface ProfitTarget {
  profit_target_pct: number | null;
  /** net_base × pct / 100, 2 dp; null when no target. */
  profit_target_amount: number | null;
  /** margin − profit_target_amount (negative = below target); null when no target. */
  profit_gap: number | null;
}

/** Target over a NET base (gross minus deductions) against the margin it left. */
export function profitTargetFor(pct: number | null, netBase: number, margin: number): ProfitTarget {
  if (pct === null) return { profit_target_pct: null, profit_target_amount: null, profit_gap: null };
  const amount = round2((round2(num(netBase)) * pct) / 100);
  return { profit_target_pct: pct, profit_target_amount: amount, profit_gap: round2(round2(num(margin)) - amount) };
}

export interface CostRule {
  id?: string;
  kind: CostKind;
  match_key: string;
  label: string;
  amount: number;
  unit: "fixed" | "percent";
  active: boolean;
  sort_order: number;
  notes?: string | null;
}

/** What a line is, for the API and the breakdowns (`lineKind`). `tax` is never a rule: it comes from the order. */
export type CostLineKind = CostKind | "tax" | "seller_commission" | "manual";

/**
 * Which block of the model a line sits in:
 *   deduction — taken out of the gross before anything is distributed
 *   material  — fixed amounts (frame, lens codes, per-order items)
 *   percent   — the owner's % allocations of the net base
 *   seller    — the seller's commission (% of the net base)
 *   manual    — a line of the owner's stored override
 */
export type CostLineGroup = "deduction" | "material" | "percent" | "seller" | "manual";

export interface CostLine {
  /** Stable key, e.g. "frame:FX2043-BLK", "lens_design:sv", "order_percent:payment_fee", "tax:order". */
  key: string;
  /** Concept the line belongs to — a rule kind, the order's tax, the seller's commission or a manual adjustment. */
  kind: CostLineKind;
  group: CostLineGroup;
  label: string;
  /** Unit amount (currency, or the computed amount for percent lines). */
  amount: number;
  qty: number;
  subtotal: number;
  source: "rule" | "manual" | "order" | "seller";
  rule_id?: string;
  /** The rule's match key (brand slug, SKU, lens code, fixed-cost slug…) — what `conceptKey` groups by. */
  match_key?: string;
  /** True when a rule matched but its amount is 0 ("sin costo definido"). */
  undefined_cost?: boolean;
}

export interface CostSheet {
  lines: CostLine[];
  /** What the customer paid (`order.total`). */
  gross: number;
  /** Same as `gross`, kept for the panel and the sheet. */
  revenue: number;
  /** Shipping + taxes + payment fees: pass-through money, out before distributing. */
  deductions_total: number;
  /** gross − deductions, floored at 0 — what the percentages and the target apply to. */
  net_base: number;
  /** Frame + lens codes + per-order fixed items. */
  materials_total: number;
  /** The owner's % allocations (rent, service…) of the net base. */
  percent_total: number;
  /** The seller's commission (% of the net base). */
  commission_total: number;
  /** deductions + materials + percent + commission (all lines; the manual lines when overridden). */
  cost_total: number;
  /** gross − cost_total: the owner's profit. */
  margin: number;
  /** margin / gross × 100. */
  margin_pct: number;
  /** margin / net_base × 100. */
  profit_pct_net: number;
  profit_target_pct: number | null;
  /** net_base × profit_target_pct / 100; null without a target. */
  profit_target_amount: number | null;
  /** margin − profit_target_amount (negative = below target); null without a target. */
  profit_gap: number | null;
  /**
   * Cost-based price that would leave exactly the target: with S = shipping +
   * tax, f = payment fee fraction (of gross), F = fixed fee, M = materials,
   * p = percent items + commission (fractions of net), g = target fraction:
   * net* = M / (1 − p − g) and price = (net* + S + F) / (1 − f). Null when
   * there is no target, no materials, or 1 − p − g ≤ 0.
   */
  suggested_price: number | null;
  /** suggested_price − gross; null when no suggestion. */
  suggested_delta: number | null;
  /** True when the lines come from the owner's override, not the rules. */
  manual: boolean;
}

/** Stored on `order.metadata.cost_sheet` when the owner overrides. */
export interface StoredCostSheet {
  lines: Array<{ key: string; label: string; amount: number; qty: number }>;
  updated_at: string;
  updated_by: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ── Catalog (what the rules can match) ───────────────────────────────────────

/** Brands the store sells (`brand_slug` on product metadata, from the scraper). */
export const KNOWN_BRANDS: Array<{ slug: string; name: string }> = [
  { slug: "di-caprio", name: "Di Caprio" },
  { slug: "flexure", name: "Flexure" },
  { slug: "millennial", name: "Millennial" },
  { slug: "peachtree", name: "Peachtree" },
  { slug: "4u", name: "Four You" },
  { slug: "trendy", name: "Trendy" },
  { slug: "simply-lite", name: "Simplylite" },
  { slug: "grande", name: "Grande" },
  { slug: "prorx", name: "ProRx" },
  { slug: "case", name: "Cases (estuches)" },
];

/** Fallback lens codes (apps/capri-storefront/src/data/lensPricing.js) when the lens-config module is unreachable. */
export const FALLBACK_LENS_CATALOG: Omit<CostCatalog, "brands"> = {
  designs: [
    { code: "sv", label: "Visión Sencilla" },
    { code: "bifocal", label: "Bifocal FT-28" },
    { code: "prog-mid", label: "Progresivo Gama Media" },
    { code: "prog-high", label: "Progresivo Gama Alta" },
  ],
  materials: [
    { code: "cr39", label: "CR-39 (Resina)" },
    { code: "poly", label: "Policarbonato" },
    { code: "1.67", label: "Índice 1.67" },
    { code: "1.74", label: "Índice 1.74" },
  ],
  photo: [
    { code: "photo-grey", label: "Fotocromático Grey" },
    { code: "photo-brown", label: "Fotocromático Brown" },
    { code: "trans-s-grey", label: "Transitions Gen S Grey" },
    { code: "trans-s-brown", label: "Transitions Gen S Brown" },
    { code: "trans-s-green", label: "Transitions Gen S Graphite Green" },
    { code: "trans-x-grey", label: "Transitions Xtractive Grey" },
    { code: "trans-x-brown", label: "Transitions Xtractive Brown (RAM)" },
  ],
  ar: [
    { code: "ar-green", label: "AR Green" },
    { code: "ar-blue", label: "AR Blue" },
  ],
};

export interface CostCatalog {
  brands: Array<{ slug: string; name: string }>;
  designs: Array<{ code: string; label: string }>;
  materials: Array<{ code: string; label: string }>;
  photo: Array<{ code: string; label: string }>;
  ar: Array<{ code: string; label: string }>;
}

/** Lens codes with Spanish labels from the lens-config module; hard-coded list when the query fails. */
export async function loadCostCatalog(container: MedusaContainer): Promise<CostCatalog> {
  const brands = KNOWN_BRANDS;
  try {
    const lens = container.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
    const pick = (rows: unknown[]) =>
      (rows as Array<Record<string, unknown>>)
        .filter((r) => r["is_active"] !== false && !r["deleted_at"])
        .map((r) => ({ code: String(r["code"]), label: String(r["label_es"] ?? r["label_en"] ?? r["code"]) }));
    const [designs, materials, photo, ar] = await Promise.all([
      lens.listLensDesigns({}, { order: { sort: "ASC" } }),
      lens.listLensMaterials({}, { order: { sort: "ASC" } }),
      lens.listLensPhotoOptions({}, { order: { sort: "ASC" } }),
      lens.listLensArOptions({}, { order: { sort: "ASC" } }),
    ]);
    const cat = { brands, designs: pick(designs), materials: pick(materials), photo: pick(photo), ar: pick(ar) };
    if (cat.designs.length && cat.materials.length) return cat;
  } catch {
    /* fall through to the hard-coded list */
  }
  return { brands, ...FALLBACK_LENS_CATALOG };
}

// ── Default rules ────────────────────────────────────────────────────────────

/** What the table is seeded with the first time the panel opens the rules. */
export function defaultCostRules(catalog: CostCatalog): CostRule[] {
  let sort = 0;
  const rule = (kind: CostKind, match_key: string, label: string, amount = 0, unit: "fixed" | "percent" = "fixed"): CostRule => ({
    kind,
    match_key,
    label,
    amount,
    unit,
    active: true,
    sort_order: sort++,
    notes: null,
  });
  return [
    rule("order_percent", PAYMENT_FEE_KEY, "Comisión del cobro (porcentaje)", 2.9, "percent"),
    rule("payment_fixed", "payment_fee_fixed", "Comisión del cobro (fija por pedido)", 0.3),
    rule("shipping", "actual", "Envío (lo que pagó el cliente)", 0),
    rule("order_fixed", "lab", "Laboratorio (montaje)", 0),
    rule("order_fixed", "packaging", "Empaque", 0),
    // A goal, not a cost: computeCostSheet never turns it into a line.
    rule("order_percent", PROFIT_TARGET_KEY, "Ganancia objetivo", DEFAULT_PROFIT_TARGET_PCT, "percent"),
    ...catalog.brands.map((b) => rule("frame_brand", b.slug, `Montura ${b.name}`)),
    ...catalog.designs.map((d) => rule("lens_design", d.code, `Lente ${d.label}`)),
    ...catalog.materials.map((m) => rule("lens_material", m.code, `Material ${m.label}`)),
    ...catalog.photo.map((p) => rule("lens_photo", p.code, p.label)),
    ...catalog.ar.map((a) => rule("lens_ar", a.code, a.label)),
  ];
}

// ── Validation ───────────────────────────────────────────────────────────────

export class CostRuleError extends Error {
  constructor(readonly reason: "bad_kind" | "bad_amount" | "duplicate" | "bad_match_key", message: string) {
    super(message);
    this.name = "CostRuleError";
  }
}

/**
 * Case per kind: SKUs uppercase, slugs/codes lowercase, free keys (per-order
 * fixed costs and percentages the owner names himself: "Atención al cliente"
 * → "atencion_al_cliente") folded to a slug.
 */
export function normalizeMatchKey(kind: CostKind, value: unknown): string {
  const s = String(value ?? "").trim();
  if (kind === "frame_sku") return s.toUpperCase();
  if (kind === "order_fixed" || kind === "order_percent") {
    return s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }
  return s.toLowerCase();
}

/** Validate a batch of rules from the panel; throws CostRuleError. */
export function validateCostRules(input: unknown[]): CostRule[] {
  const out: CostRule[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const kind = r["kind"];
    if (!isCostKind(kind)) throw new CostRuleError("bad_kind", `Unknown rule kind '${String(kind)}'.`);
    const match_key = normalizeMatchKey(kind, r["match_key"]);
    // Percent allocations are named by the owner (slug ≤ 40); the rest match catalog codes.
    const maxKey = kind === "order_percent" ? 40 : 80;
    if (!match_key || match_key.length > maxKey) throw new CostRuleError("bad_match_key", `Rule of kind '${kind}' needs a match key (at most ${maxKey} characters).`);
    if (kind === "order_percent" && match_key === SELLER_COMMISSION_KEY) {
      throw new CostRuleError("bad_match_key", "The seller commission is computed from the seller, not a rule.");
    }
    const amount = Number(r["amount"] ?? 0);
    if (!Number.isFinite(amount) || amount < 0) throw new CostRuleError("bad_amount", `Rule ${kind}/${match_key}: amount must be a non-negative number.`);
    const unit: "fixed" | "percent" = kind === "order_percent" ? "percent" : r["unit"] === "percent" ? "percent" : "fixed";
    if (unit === "percent" && amount > 100) throw new CostRuleError("bad_amount", `Rule ${kind}/${match_key}: a percentage cannot exceed 100.`);
    const dup = `${kind}:${match_key}`;
    if (seen.has(dup)) throw new CostRuleError("duplicate", `Rule ${kind}/${match_key} appears twice.`);
    seen.add(dup);
    const label = String(r["label"] ?? "").trim().slice(0, 120) || `${KIND_LABEL[kind]} ${match_key}`;
    out.push({
      id: typeof r["id"] === "string" && r["id"] ? r["id"] : undefined,
      kind,
      match_key,
      label,
      amount: round2(amount),
      unit,
      active: r["active"] !== false,
      sort_order: Number.isFinite(Number(r["sort_order"])) ? Math.floor(Number(r["sort_order"])) : 0,
      notes: typeof r["notes"] === "string" ? r["notes"].trim().slice(0, 1000) || null : null,
    });
  }
  return out;
}

// ── The math ─────────────────────────────────────────────────────────────────

/** The slice of a board order the sheet needs (so tests can pass a literal). */
export interface CostOrderLike {
  total?: unknown;
  shipping_total?: unknown;
  tax_total?: unknown;
  paid?: boolean;
  items: Array<{
    title?: string;
    quantity?: unknown;
    sku?: string | null;
    brand_slug?: string | null;
    lens?: { design_code?: string | null; material_code?: string | null; photo_code?: string | null; ar_code?: string | null } | null;
  }>;
}

function ruleIndex(rules: CostRule[]): Map<string, CostRule> {
  const idx = new Map<string, CostRule>();
  for (const r of rules) {
    if (!r.active) continue;
    idx.set(`${r.kind}:${normalizeMatchKey(r.kind, r.match_key)}`, r);
  }
  return idx;
}

/** Block of the model a rule-driven line belongs to (the seller and manual lines are tagged where they are built). */
function groupForRule(rule: Pick<CostRule, "kind" | "match_key">): CostLineGroup {
  if (rule.kind === "shipping" || rule.kind === "payment_fixed") return "deduction";
  if (rule.kind === "order_percent") return isPaymentFeeRule(rule) ? "deduction" : "percent";
  return "material";
}

function lineFromRule(rule: CostRule, key: string, qty: number, amountOverride?: number): CostLine {
  const amount = round2(amountOverride ?? rule.amount);
  return {
    key,
    kind: rule.kind,
    group: groupForRule(rule),
    label: rule.label,
    amount,
    qty,
    subtotal: round2(amount * qty),
    source: "rule",
    rule_id: rule.id,
    match_key: normalizeMatchKey(rule.kind, rule.match_key),
    undefined_cost: amount === 0,
  };
}

/** Shared tail of the sheet: totals, net base, target and the suggested price. */
interface SheetModel {
  gross: number;
  /** Fixed pass-through deductions (shipping + tax), i.e. not proportional to the gross. */
  fixed_deductions: number;
  /** Payment fee fraction of the gross (0.029 for 2.9 %). */
  fee_fraction: number;
  /** Fixed payment fee (0 when none / unpaid). */
  fee_fixed: number;
  materials: number;
  /** Percent items + seller commission, as a fraction of the net base. */
  net_fraction: number;
  deductions_total: number;
  net_base: number;
  percent_total: number;
  commission_total: number;
  cost_total: number;
  target_pct: number | null;
}

function finishSheet(lines: CostLine[], m: SheetModel, manual: boolean): CostSheet {
  const margin = round2(m.gross - m.cost_total);
  const target = profitTargetFor(m.target_pct, m.net_base, margin);
  const suggested = suggestedPrice(m, manual);
  return {
    lines,
    gross: m.gross,
    revenue: m.gross,
    deductions_total: m.deductions_total,
    net_base: m.net_base,
    materials_total: m.materials,
    percent_total: m.percent_total,
    commission_total: m.commission_total,
    cost_total: m.cost_total,
    margin,
    margin_pct: m.gross > 0 ? round2((margin / m.gross) * 100) : 0,
    profit_pct_net: m.net_base > 0 ? round2((margin / m.net_base) * 100) : 0,
    ...target,
    suggested_price: suggested,
    suggested_delta: suggested === null ? null : round2(suggested - m.gross),
    manual,
  };
}

/**
 * Price that leaves exactly the target profit (see `CostSheet.suggested_price`).
 * For a manual sheet the stored lines ARE the whole cost (they usually carry
 * the shipping the owner typed), so the target is solved against them:
 * price − M = g × (price − S)  ⇒  price = (M − g·S) / (1 − g).
 */
function suggestedPrice(m: SheetModel, manual: boolean): number | null {
  if (m.target_pct === null || m.materials <= 0) return null;
  const g = m.target_pct / 100;
  if (manual) {
    const denom = 1 - g;
    if (denom <= 0) return null;
    const price = (m.materials - g * m.fixed_deductions) / denom;
    return price > 0 ? round2(price) : null;
  }
  const denom = 1 - m.net_fraction - g;
  const feeDenom = 1 - m.fee_fraction;
  if (denom <= 0 || feeDenom <= 0) return null;
  const netStar = m.materials / denom;
  const price = (netStar + m.fixed_deductions + m.fee_fixed) / feeDenom;
  return price > 0 ? round2(price) : null;
}

/**
 * Cost sheet of one order from the rules (or from the owner's stored lines).
 *
 * Deductions first (shipping: actual = what the customer paid, or a fixed
 * figure; the order's taxes; the gateway's % of the gross and its fixed fee),
 * which gives the net base. Then materials per item (`frame_sku` by SKU beats
 * `frame_brand` by brand; a case/estuche only ever matches by SKU or the
 * "case" brand; one line per lens code the item carries) and per order
 * (`order_fixed`). Then the owner's percentages and the seller's commission,
 * both of the NET base. The profit target (`profitTargetPct` of the rules,
 * or `targetPct` when given) is reported, never charged.
 */
export function computeCostSheet(
  order: CostOrderLike,
  rules: CostRule[],
  seller?: { commission_pct: number } | null,
  manual?: StoredCostSheet | null,
  targetPct?: number | null
): CostSheet {
  const gross = round2(num(order.total));
  const target_pct = targetPct === undefined ? profitTargetPct(rules) : targetPct !== null && targetPct > 0 ? round2(targetPct) : null;
  const orderShipping = round2(Math.max(0, num(order.shipping_total)));
  const orderTax = round2(Math.max(0, num(order.tax_total)));

  if (manual && Array.isArray(manual.lines)) {
    const lines: CostLine[] = manual.lines.map((l) => {
      const amount = round2(num(l.amount));
      const qty = Math.max(0, num(l.qty) || 1);
      return { key: String(l.key ?? ""), kind: "manual", group: "manual", label: String(l.label ?? ""), amount, qty, subtotal: round2(amount * qty), source: "manual" };
    });
    const cost_total = round2(lines.reduce((a, l) => a + l.subtotal, 0));
    // The stored lines are the whole cost; the net base still comes from the
    // order's own pass-through fields so the target means the same thing.
    const deductions_total = round2(orderShipping + orderTax);
    return finishSheet(
      lines,
      {
        gross,
        fixed_deductions: deductions_total,
        fee_fraction: 0,
        fee_fixed: 0,
        materials: cost_total,
        net_fraction: 0,
        deductions_total,
        net_base: round2(Math.max(0, gross - deductions_total)),
        percent_total: 0,
        commission_total: 0,
        cost_total,
        target_pct,
      },
      true
    );
  }

  const idx = ruleIndex(rules);
  // The profit target is a goal, not a cost: it never becomes a line.
  const active = rules.filter((r) => r.active && !isProfitTargetRule(r));
  const deductions: CostLine[] = [];
  const materials: CostLine[] = [];
  const percents: CostLine[] = [];
  let fee_fraction = 0;
  let fee_fixed = 0;

  // ── 1. Deductions (pass-through money, out of the gross first) ──
  for (const r of active.filter((x) => x.kind === "shipping")) {
    const key = normalizeMatchKey("shipping", r.match_key);
    if (key === "actual") {
      deductions.push({ ...lineFromRule(r, "shipping:actual", 1, orderShipping), source: "order", undefined_cost: false });
    } else {
      deductions.push(lineFromRule(r, `shipping:${key}`, 1));
    }
  }
  if (orderTax > 0) {
    deductions.push({
      key: "tax:order",
      kind: "tax",
      group: "deduction",
      label: "Impuestos (lo que pagó el cliente)",
      amount: orderTax,
      qty: 1,
      subtotal: orderTax,
      source: "order",
      match_key: "order",
      undefined_cost: false,
    });
  }
  for (const r of active.filter((x) => isPaymentFeeRule(x))) {
    const amount = round2((gross * r.amount) / 100);
    const line = lineFromRule(r, `order_percent:${r.match_key}`, 1, amount);
    line.undefined_cost = r.amount === 0;
    deductions.push(line);
    fee_fraction += r.amount / 100;
  }
  for (const r of active.filter((x) => x.kind === "payment_fixed")) {
    if (order.paid === false) continue;
    const line = lineFromRule(r, `payment_fixed:${r.match_key}`, 1);
    deductions.push(line);
    fee_fixed = round2(fee_fixed + line.subtotal);
  }
  const fixed_deductions = round2(deductions.filter((l) => l.kind === "shipping" || l.kind === "tax").reduce((a, l) => a + l.subtotal, 0));
  const deductions_total = round2(deductions.reduce((a, l) => a + l.subtotal, 0));
  const net_base = round2(Math.max(0, gross - deductions_total));

  // ── 2. Materials (fixed amounts) ──
  for (const item of order.items ?? []) {
    const qty = Math.max(1, Math.floor(num(item.quantity)) || 1);
    const sku = item.sku ? String(item.sku).toUpperCase() : null;
    const brand = item.brand_slug ? String(item.brand_slug).toLowerCase() : null;
    const bySku = sku ? idx.get(`frame_sku:${sku}`) : undefined;
    const byBrand = brand ? idx.get(`frame_brand:${brand}`) : undefined;
    const frame = bySku ?? byBrand;
    if (frame) {
      materials.push(lineFromRule(frame, `frame:${sku ?? brand}`, qty));
    } else {
      materials.push({
        key: `frame:${sku ?? brand ?? "?"}`,
        kind: "frame_brand",
        group: "material",
        label: `Montura ${item.title ?? sku ?? brand ?? ""}`.trim(),
        amount: 0,
        qty,
        subtotal: 0,
        source: "rule",
        match_key: brand ?? sku ?? "?",
        undefined_cost: true,
      });
    }
    const lens = item.lens ?? {};
    const lensParts: Array<[CostKind, string | null | undefined]> = [
      ["lens_design", lens.design_code],
      ["lens_material", lens.material_code],
      ["lens_photo", lens.photo_code],
      ["lens_ar", lens.ar_code],
    ];
    for (const [kind, code] of lensParts) {
      if (!code || code === "frame-only") continue;
      const rule = idx.get(`${kind}:${normalizeMatchKey(kind, code)}`);
      if (rule) materials.push(lineFromRule(rule, `${kind}:${code}`, qty));
      else materials.push({ key: `${kind}:${code}`, kind, group: "material", label: `${KIND_LABEL[kind]} ${code}`, amount: 0, qty, subtotal: 0, source: "rule", match_key: normalizeMatchKey(kind, code), undefined_cost: true });
    }
  }
  for (const r of active.filter((x) => x.kind === "order_fixed")) {
    materials.push(lineFromRule(r, `order_fixed:${r.match_key}`, 1));
  }
  const materials_total = round2(materials.reduce((a, l) => a + l.subtotal, 0));

  // ── 3. Distribution of the net base: the owner's percentages, then the seller ──
  let net_fraction = 0;
  for (const r of active.filter((x) => x.kind === "order_percent" && !isPaymentFeeRule(x))) {
    const amount = round2((net_base * r.amount) / 100);
    const line = lineFromRule(r, `order_percent:${r.match_key}`, 1, amount);
    line.undefined_cost = r.amount === 0;
    percents.push(line);
    net_fraction += r.amount / 100;
  }
  const percent_total = round2(percents.reduce((a, l) => a + l.subtotal, 0));
  const sellerLines: CostLine[] = [];
  if (seller && num(seller.commission_pct) > 0) {
    const pct = num(seller.commission_pct);
    const amount = round2((net_base * pct) / 100);
    sellerLines.push({
      key: `order_percent:${SELLER_COMMISSION_KEY}`,
      kind: "seller_commission",
      group: "seller",
      label: `Comisión del vendedor (${pct}%)`,
      amount,
      qty: 1,
      subtotal: amount,
      source: "seller",
      match_key: SELLER_COMMISSION_KEY,
    });
    net_fraction += pct / 100;
  }
  const commission_total = round2(sellerLines.reduce((a, l) => a + l.subtotal, 0));

  const lines = [...deductions, ...materials, ...percents, ...sellerLines];
  const cost_total = round2(deductions_total + materials_total + percent_total + commission_total);
  return finishSheet(
    lines,
    { gross, fixed_deductions, fee_fraction, fee_fixed, materials: materials_total, net_fraction, deductions_total, net_base, percent_total, commission_total, cost_total, target_pct },
    false
  );
}

/** Lines that matched a rule whose amount is still 0. */
export function undefinedCostCount(sheet: CostSheet): number {
  return sheet.lines.filter((l) => l.undefined_cost).length;
}

/**
 * Kind of a line. Lines computed here always carry `kind`; the key/source
 * fallback covers lines read from an older stored sheet or hand-built tests.
 */
export function lineKind(line: Pick<CostLine, "key" | "source"> & { kind?: CostLineKind }): CostLineKind {
  if (line.kind) return line.kind;
  if (line.source === "manual") return "manual";
  if (line.source === "seller") return "seller_commission";
  const [head] = line.key.split(":");
  if (head === "frame") return "frame_brand";
  if (head === "tax") return "tax";
  return isCostKind(head) ? head : "manual";
}

export const LINE_KIND_LABEL: Record<CostLineKind, string> = {
  ...KIND_LABEL,
  tax: "Impuestos",
  seller_commission: "Comisión de vendedores",
  manual: "Ajustes manuales",
};

/** Group of a line; lines computed here carry it, older stored lines fall back on the kind. */
export function lineGroup(line: Pick<CostLine, "key" | "source"> & { kind?: CostLineKind; group?: CostLineGroup }): CostLineGroup {
  if (line.group) return line.group;
  const kind = lineKind(line);
  if (kind === "manual") return "manual";
  if (kind === "seller_commission") return "seller";
  if (kind === "tax" || kind === "shipping" || kind === "payment_fixed") return "deduction";
  if (kind === "order_percent") return line.key.endsWith(`:${PAYMENT_FEE_KEY}`) ? "deduction" : "percent";
  return "material";
}

/**
 * Concept a line is grouped under in the summary: `${kind}:${match_key}` for
 * rule-driven lines ("frame_brand:flexure", "order_percent:rent"), the bare
 * kind for the seller's commission and manual adjustments.
 */
export function conceptKey(line: CostLine): string {
  const kind = lineKind(line);
  if (kind === "seller_commission" || kind === "manual") return kind;
  const match = line.match_key ?? line.key.split(":").slice(1).join(":");
  return `${kind}:${match}`;
}

export interface ConceptTotal {
  kind: CostLineKind;
  key: string;
  label: string;
  amount: number;
}

/** Lines of one sheet condensed per concept (same key → one row, amounts summed), biggest first. */
export function condenseLines(lines: CostLine[]): ConceptTotal[] {
  const map = new Map<string, ConceptTotal>();
  for (const l of lines) {
    const key = conceptKey(l);
    const kind = lineKind(l);
    const row = map.get(key) ?? { kind, key, label: kind === "seller_commission" || kind === "manual" ? LINE_KIND_LABEL[kind] : l.label, amount: 0 };
    row.amount = round2(row.amount + l.subtotal);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

/**
 * One line of the sheet's text summary ("Montura Peachtree 12.00 · Envío real
 * 28.00 · Vendedor ANA (10%) 4.30"): label + subtotal per line, joined by
 * " · ". Empty when there are no lines.
 */
export function costBreakdownText(lines: Array<Pick<CostLine, "label" | "subtotal">> | null | undefined): string {
  if (!lines?.length) return "";
  return lines.map((l) => `${String(l.label ?? "").trim() || "—"} ${round2(num(l.subtotal)).toFixed(2)}`).join(" · ");
}

// ── Summary aggregation (pure) ───────────────────────────────────────────────

/** The slice of a board order + its sheet that the summary groups. */
export interface SummaryEntry {
  order: Pick<BoardOrder, "id" | "display_id" | "created_at" | "seller_code" | "seller_source" | "items"> & { customer_name: string | null };
  sheet: CostSheet;
}

export interface SummaryBySeller { code: string | null; name: string; orders: number; revenue: number; cost: number; margin: number; commission: number }
export interface SummaryByDay { date: string; orders: number; revenue: number; cost: number; margin: number }
export interface SummaryByBrand { slug: string; name: string; orders: number; revenue: number; frame_cost: number; margin_share: number }
export interface SummaryBrandRevenue { slug: string; name: string; revenue: number }

/** The window's totals in the same shape as one sheet (sums, then the derived percentages). */
export interface SummaryTotals {
  orders: number;
  /** = revenue: what the customers paid. */
  gross: number;
  revenue: number;
  deductions: number;
  net_base: number;
  materials: number;
  percent_items: number;
  commission: number;
  cost: number;
  /** = margin: what the owner kept. */
  profit: number;
  margin: number;
  margin_pct: number;
  profit_pct_net: number;
  profit_target_pct: number | null;
  /** Sum of every order's target; null when no order had one. */
  profit_target_amount: number | null;
  profit_gap: number | null;
}

export function brandName(slug: string): string {
  return KNOWN_BRANDS.find((b) => b.slug === slug)?.name ?? slug;
}

/** Item totals per brand slug of one order (items without a brand go under "?"). */
export function orderBrands(items: BoardOrder["items"]): SummaryBrandRevenue[] {
  const map = new Map<string, number>();
  for (const it of items ?? []) {
    const slug = String(it.brand_slug ?? "").toLowerCase() || "?";
    map.set(slug, round2((map.get(slug) ?? 0) + num(it.total)));
  }
  return [...map.entries()].map(([slug, revenue]) => ({ slug, name: brandName(slug), revenue })).sort((a, b) => b.revenue - a.revenue || a.slug.localeCompare(b.slug));
}

/** "YYYY-MM-DD" of an instant in the given IANA zone (UTC when the zone is unknown). */
export function dayKey(value: unknown, timeZone = process.env.GSHEET_TIMEZONE || "UTC"): string {
  const d = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Totals of a window of sheets, per concept / seller / day / brand. Pure, so
 * the grouping is testable on literals; the route only loads and iterates.
 */
export function summarizeCostSheets(
  entries: SummaryEntry[],
  sellers: Map<string, { name?: string; commission_pct: number }>,
  timeZone?: string
): { totals: SummaryTotals; by_kind: ConceptTotal[]; by_seller: SummaryBySeller[]; by_day: SummaryByDay[]; by_brand: SummaryByBrand[] } {
  const concepts = new Map<string, ConceptTotal>();
  const bySeller = new Map<string, SummaryBySeller>();
  const byDay = new Map<string, SummaryByDay>();
  const byBrand = new Map<string, SummaryByBrand>();
  const totals: SummaryTotals = {
    orders: 0, gross: 0, revenue: 0, deductions: 0, net_base: 0, materials: 0, percent_items: 0, commission: 0, cost: 0,
    profit: 0, margin: 0, margin_pct: 0, profit_pct_net: 0, profit_target_pct: null, profit_target_amount: null, profit_gap: null,
  };

  for (const { order, sheet } of entries) {
    totals.orders++;
    totals.gross = round2(totals.gross + sheet.gross);
    totals.deductions = round2(totals.deductions + sheet.deductions_total);
    totals.net_base = round2(totals.net_base + sheet.net_base);
    totals.materials = round2(totals.materials + sheet.materials_total);
    totals.percent_items = round2(totals.percent_items + sheet.percent_total);
    totals.commission = round2(totals.commission + sheet.commission_total);
    totals.cost = round2(totals.cost + sheet.cost_total);
    if (sheet.profit_target_amount !== null) {
      totals.profit_target_amount = round2((totals.profit_target_amount ?? 0) + sheet.profit_target_amount);
      totals.profit_target_pct = totals.profit_target_pct ?? sheet.profit_target_pct;
    }

    for (const c of condenseLines(sheet.lines)) {
      const row = concepts.get(c.key) ?? { ...c, amount: 0 };
      row.amount = round2(row.amount + c.amount);
      concepts.set(c.key, row);
    }

    const code = order.seller_code ?? null;
    const sellerKey = code ?? "none";
    const seller = code ? sellers.get(code) : undefined;
    const s = bySeller.get(sellerKey) ?? { code, name: code ? seller?.name ?? code : "none", orders: 0, revenue: 0, cost: 0, margin: 0, commission: 0 };
    s.orders++;
    s.revenue = round2(s.revenue + sheet.revenue);
    s.cost = round2(s.cost + sheet.cost_total);
    s.margin = round2(s.margin + sheet.margin);
    s.commission = round2(s.commission + sheet.lines.filter((l) => lineKind(l) === "seller_commission").reduce((a, l) => a + l.subtotal, 0));
    bySeller.set(sellerKey, s);

    const date = dayKey(order.created_at, timeZone);
    const d = byDay.get(date) ?? { date, orders: 0, revenue: 0, cost: 0, margin: 0 };
    d.orders++;
    d.revenue = round2(d.revenue + sheet.revenue);
    d.cost = round2(d.cost + sheet.cost_total);
    d.margin = round2(d.margin + sheet.margin);
    byDay.set(date, d);

    // Frame cost per brand: frame lines keyed "frame:<sku|brand>" matched to
    // the item they came from (same order as the items).
    const frameLines = sheet.lines.filter((l) => l.key.startsWith("frame:"));
    for (const b of orderBrands(order.items)) {
      const row = byBrand.get(b.slug) ?? { slug: b.slug, name: b.name, orders: 0, revenue: 0, frame_cost: 0, margin_share: 0 };
      row.orders++;
      row.revenue = round2(row.revenue + b.revenue);
      byBrand.set(b.slug, row);
    }
    (order.items ?? []).forEach((it, i) => {
      const slug = String(it.brand_slug ?? "").toLowerCase() || "?";
      const line = frameLines[i];
      const row = byBrand.get(slug);
      if (row && line) row.frame_cost = round2(row.frame_cost + line.subtotal);
    });
  }
  for (const row of byBrand.values()) row.margin_share = round2(row.revenue - row.frame_cost);

  totals.revenue = totals.gross;
  totals.margin = round2(totals.gross - totals.cost);
  totals.profit = totals.margin;
  totals.margin_pct = totals.gross > 0 ? round2((totals.margin / totals.gross) * 100) : 0;
  totals.profit_pct_net = totals.net_base > 0 ? round2((totals.margin / totals.net_base) * 100) : 0;
  totals.profit_gap = totals.profit_target_amount === null ? null : round2(totals.margin - totals.profit_target_amount);

  return {
    totals,
    by_kind: [...concepts.values()].sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key)),
    by_seller: [...bySeller.values()].sort((a, b) => b.revenue - a.revenue || (a.code ?? "zzz").localeCompare(b.code ?? "zzz")),
    by_day: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    by_brand: [...byBrand.values()].sort((a, b) => b.revenue - a.revenue || a.slug.localeCompare(b.slug)),
  };
}

// ── Container helpers ────────────────────────────────────────────────────────

export function costingService(container: MedusaContainer): CostingModuleService {
  return container.resolve<CostingModuleService>(COSTING_MODULE);
}

function rowToRule(r: Record<string, unknown>): CostRule {
  return {
    id: String(r["id"]),
    kind: r["kind"] as CostKind,
    match_key: String(r["match_key"] ?? ""),
    label: String(r["label"] ?? ""),
    amount: round2(num(r["amount"])),
    unit: r["unit"] === "percent" ? "percent" : "fixed",
    active: r["active"] !== false,
    sort_order: num(r["sort_order"]),
    notes: (r["notes"] as string | null) ?? null,
  };
}

/** Live rules, sorted. */
export async function listCostRules(container: MedusaContainer): Promise<CostRule[]> {
  const svc = costingService(container);
  const rows = (await svc.listCostRules({}, { take: 1000 })) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => !r["deleted_at"])
    .map(rowToRule)
    .sort((a, b) => a.sort_order - b.sort_order || a.kind.localeCompare(b.kind) || a.match_key.localeCompare(b.match_key));
}

/** Seed the defaults when the table is empty. Returns true when it seeded. */
export async function seedCostRulesIfEmpty(container: MedusaContainer, catalog: CostCatalog): Promise<boolean> {
  const existing = await listCostRules(container);
  if (existing.length) return false;
  const svc = costingService(container);
  await svc.createCostRules(defaultCostRules(catalog).map((r) => ({ ...r, id: undefined })));
  return true;
}

/** Upsert a validated batch; (kind, match_key) decides whether a row is new. */
export async function upsertCostRules(container: MedusaContainer, rules: CostRule[]): Promise<CostRule[]> {
  const svc = costingService(container);
  const existing = await listCostRules(container);
  const byId = new Map(existing.map((r) => [r.id, r]));
  const byKey = new Map(existing.map((r) => [`${r.kind}:${r.match_key}`, r]));
  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  for (const r of rules) {
    const target = (r.id && byId.get(r.id)) || byKey.get(`${r.kind}:${r.match_key}`);
    const data = { kind: r.kind, match_key: r.match_key, label: r.label, amount: r.amount, unit: r.unit, active: r.active, sort_order: r.sort_order, notes: r.notes ?? null };
    if (target?.id) {
      // Renaming to a key another live rule already holds is a duplicate.
      const clash = byKey.get(`${r.kind}:${r.match_key}`);
      if (clash && clash.id !== target.id) throw new CostRuleError("duplicate", `Rule ${r.kind}/${r.match_key} already exists.`);
      updates.push({ id: target.id, ...data });
    } else {
      creates.push(data);
    }
  }
  if (updates.length) await svc.updateCostRules(updates);
  if (creates.length) await svc.createCostRules(creates);
  return listCostRules(container);
}

/** Stored manual override on an order, or null. */
export function readStoredSheet(metadata: Record<string, unknown> | null | undefined): StoredCostSheet | null {
  const raw = metadata?.["cost_sheet"];
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as StoredCostSheet).lines)) return null;
  const s = raw as StoredCostSheet;
  return { lines: s.lines, updated_at: String(s.updated_at ?? ""), updated_by: s.updated_by ?? null };
}

/**
 * Write (or clear) the manual override on `order.metadata.cost_sheet`. Merges
 * metadata — `updateOrders` replaces the object wholesale, and everything the
 * checkout and the board wrote lives in the same bag.
 */
export async function saveStoredSheet(
  container: MedusaContainer,
  orderId: string,
  sheet: StoredCostSheet | null
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: "order", fields: ["id", "metadata"], filters: { id: orderId } });
  const current = ((data?.[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  if (sheet) next["cost_sheet"] = sheet;
  else delete next["cost_sheet"];
  const orders = container.resolve<IOrderModuleService>(Modules.ORDER);
  await orders.updateOrders([{ id: orderId, metadata: next }]);
}

/** Sheet of a projected board order (rules + seller + stored override). Best effort on the seller lookup. */
export async function costSheetForOrder(
  container: MedusaContainer,
  order: BoardOrder,
  rules: CostRule[],
  sellerByCode: Map<string, { commission_pct: number }>,
  metadata?: Record<string, unknown> | null
): Promise<CostSheet> {
  const seller = order.seller_code ? sellerByCode.get(order.seller_code) ?? null : null;
  const stored = readStoredSheet(metadata);
  return computeCostSheet(
    { total: order.total, shipping_total: order.shipping_total, tax_total: order.tax_total, paid: order.paid, items: order.items },
    rules,
    seller,
    stored
  );
}

/** Rules + seller commission map in one call; empty on failure (callers degrade). */
export async function loadCostingContext(
  container: MedusaContainer
): Promise<{ rules: CostRule[]; sellerByCode: Map<string, { commission_pct: number; name: string }> }> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  let rules: CostRule[] = [];
  const sellerByCode = new Map<string, { commission_pct: number; name: string }>();
  try {
    rules = await listCostRules(container);
  } catch (error) {
    logger.warn(`[costing] rules unavailable: ${(error as Error).message}`);
  }
  try {
    for (const s of await listSellers(container)) sellerByCode.set(s.code, { commission_pct: s.commission_pct, name: s.name });
  } catch (error) {
    logger.warn(`[costing] sellers unavailable: ${(error as Error).message}`);
  }
  return { rules, sellerByCode };
}
