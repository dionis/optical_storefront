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
 * `order_percent` match_key for the owner's target profit ("I want to keep
 * 30 % of every sale"). It is saved like any other percentage so the panel can
 * edit it in the same table, but it is NOT a cost: `computeCostSheet` skips it
 * and the routes expose it as `profit_target_pct` / `profit_target_amount` /
 * `profit_gap` next to the margin instead.
 */
export const PROFIT_TARGET_KEY = "profit_target";

export function isCostKind(value: unknown): value is CostKind {
  return typeof value === "string" && (COST_KINDS as readonly string[]).includes(value);
}

export function isProfitTargetRule(rule: Pick<CostRule, "kind" | "match_key">): boolean {
  return rule.kind === "order_percent" && normalizeMatchKey("order_percent", rule.match_key) === PROFIT_TARGET_KEY;
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
  /** revenue × pct / 100, 2 dp; null when no target. */
  profit_target_amount: number | null;
  /** margin − profit_target_amount (negative = below target); null when no target. */
  profit_gap: number | null;
}

export function profitTargetFor(pct: number | null, revenue: number, margin: number): ProfitTarget {
  if (pct === null) return { profit_target_pct: null, profit_target_amount: null, profit_gap: null };
  const amount = round2((round2(num(revenue)) * pct) / 100);
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

/** What a line is, for the API and the breakdowns (`lineKind`). */
export type CostLineKind = CostKind | "seller_commission" | "manual";

export interface CostLine {
  /** Stable key, e.g. "frame:FX2043-BLK", "lens_design:sv", "order_percent:payment_fee". */
  key: string;
  /** Concept the line belongs to — a rule kind, the seller's commission or a manual adjustment. */
  kind: CostLineKind;
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
  cost_total: number;
  revenue: number;
  margin: number;
  margin_pct: number;
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
    rule("order_percent", "payment_fee", "Comisión del cobro (porcentaje)", 2.9, "percent"),
    rule("payment_fixed", "payment_fee_fixed", "Comisión del cobro (fija por pedido)", 0.3),
    rule("shipping", "actual", "Envío (lo que pagó el cliente)", 0),
    rule("order_fixed", "lab", "Laboratorio (montaje)", 0),
    rule("order_fixed", "packaging", "Empaque", 0),
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

function lineFromRule(rule: CostRule, key: string, qty: number, amountOverride?: number): CostLine {
  const amount = round2(amountOverride ?? rule.amount);
  return {
    key,
    kind: rule.kind,
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

/**
 * Cost sheet of one order from the rules (or from the owner's stored lines).
 *
 * Per item: frame cost (`frame_sku` by SKU beats `frame_brand` by brand; a
 * case/estuche only ever matches by SKU or the "case" brand), then one line
 * per lens code the item carries. Per order: fixed items, shipping (actual =
 * what the customer paid, or a fixed figure), percent of the total, the
 * gateway's fixed fee, and the seller's commission when a seller is attached.
 */
export function computeCostSheet(
  order: CostOrderLike,
  rules: CostRule[],
  seller?: { commission_pct: number } | null,
  manual?: StoredCostSheet | null
): CostSheet {
  const revenue = round2(num(order.total));
  if (manual && Array.isArray(manual.lines)) {
    const lines: CostLine[] = manual.lines.map((l) => {
      const amount = round2(num(l.amount));
      const qty = Math.max(0, num(l.qty) || 1);
      return { key: String(l.key ?? ""), kind: "manual", label: String(l.label ?? ""), amount, qty, subtotal: round2(amount * qty), source: "manual" };
    });
    const cost_total = round2(lines.reduce((a, l) => a + l.subtotal, 0));
    const margin = round2(revenue - cost_total);
    return { lines, cost_total, revenue, margin, margin_pct: revenue > 0 ? round2((margin / revenue) * 100) : 0, manual: true };
  }

  const idx = ruleIndex(rules);
  const lines: CostLine[] = [];

  for (const item of order.items ?? []) {
    const qty = Math.max(1, Math.floor(num(item.quantity)) || 1);
    const sku = item.sku ? String(item.sku).toUpperCase() : null;
    const brand = item.brand_slug ? String(item.brand_slug).toLowerCase() : null;
    const bySku = sku ? idx.get(`frame_sku:${sku}`) : undefined;
    const byBrand = brand ? idx.get(`frame_brand:${brand}`) : undefined;
    const frame = bySku ?? byBrand;
    if (frame) {
      lines.push(lineFromRule(frame, `frame:${sku ?? brand}`, qty));
    } else {
      lines.push({
        key: `frame:${sku ?? brand ?? "?"}`,
        kind: "frame_brand",
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
      if (rule) lines.push(lineFromRule(rule, `${kind}:${code}`, qty));
      else lines.push({ key: `${kind}:${code}`, kind, label: `${KIND_LABEL[kind]} ${code}`, amount: 0, qty, subtotal: 0, source: "rule", match_key: normalizeMatchKey(kind, code), undefined_cost: true });
    }
  }

  // The profit target is a goal, not a cost: it never becomes a line.
  const active = rules.filter((r) => r.active && !isProfitTargetRule(r));
  for (const r of active.filter((x) => x.kind === "order_fixed")) {
    lines.push(lineFromRule(r, `order_fixed:${r.match_key}`, 1));
  }
  for (const r of active.filter((x) => x.kind === "shipping")) {
    const key = normalizeMatchKey("shipping", r.match_key);
    if (key === "actual") {
      const amount = round2(num(order.shipping_total));
      lines.push({ ...lineFromRule(r, "shipping:actual", 1, amount), source: "order", undefined_cost: false });
    } else {
      lines.push(lineFromRule(r, `shipping:${key}`, 1));
    }
  }
  for (const r of active.filter((x) => x.kind === "order_percent")) {
    const amount = round2((revenue * r.amount) / 100);
    const line = lineFromRule(r, `order_percent:${r.match_key}`, 1, amount);
    line.undefined_cost = r.amount === 0;
    lines.push(line);
  }
  for (const r of active.filter((x) => x.kind === "payment_fixed")) {
    if (order.paid === false) continue;
    lines.push(lineFromRule(r, `payment_fixed:${r.match_key}`, 1));
  }
  if (seller && num(seller.commission_pct) > 0) {
    const amount = round2((revenue * num(seller.commission_pct)) / 100);
    lines.push({
      key: `order_percent:${SELLER_COMMISSION_KEY}`,
      kind: "seller_commission",
      label: `Comisión del vendedor (${num(seller.commission_pct)}%)`,
      amount,
      qty: 1,
      subtotal: amount,
      source: "seller",
      match_key: SELLER_COMMISSION_KEY,
    });
  }

  const cost_total = round2(lines.reduce((a, l) => a + l.subtotal, 0));
  const margin = round2(revenue - cost_total);
  return { lines, cost_total, revenue, margin, margin_pct: revenue > 0 ? round2((margin / revenue) * 100) : 0, manual: false };
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
  return isCostKind(head) ? head : "manual";
}

export const LINE_KIND_LABEL: Record<CostLineKind, string> = {
  ...KIND_LABEL,
  seller_commission: "Comisión de vendedores",
  manual: "Ajustes manuales",
};

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
): { by_kind: ConceptTotal[]; by_seller: SummaryBySeller[]; by_day: SummaryByDay[]; by_brand: SummaryByBrand[] } {
  const concepts = new Map<string, ConceptTotal>();
  const bySeller = new Map<string, SummaryBySeller>();
  const byDay = new Map<string, SummaryByDay>();
  const byBrand = new Map<string, SummaryByBrand>();

  for (const { order, sheet } of entries) {
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

  return {
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
    { total: order.total, shipping_total: order.shipping_total, paid: order.paid, items: order.items },
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
