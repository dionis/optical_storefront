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

export function isCostKind(value: unknown): value is CostKind {
  return typeof value === "string" && (COST_KINDS as readonly string[]).includes(value);
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

export interface CostLine {
  /** Stable key, e.g. "frame:FX2043-BLK", "lens_design:sv", "order_percent:payment_fee". */
  key: string;
  label: string;
  /** Unit amount (currency, or the computed amount for percent lines). */
  amount: number;
  qty: number;
  subtotal: number;
  source: "rule" | "manual" | "order" | "seller";
  rule_id?: string;
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

/** Case per kind: SKUs uppercase, slugs/codes lowercase, free labels trimmed. */
export function normalizeMatchKey(kind: CostKind, value: unknown): string {
  const s = String(value ?? "").trim();
  if (kind === "frame_sku") return s.toUpperCase();
  if (kind === "order_fixed" || kind === "order_percent") return s.toLowerCase().replace(/\s+/g, "_");
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
    if (!match_key || match_key.length > 80) throw new CostRuleError("bad_match_key", `Rule of kind '${kind}' needs a match key.`);
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
    label: rule.label,
    amount,
    qty,
    subtotal: round2(amount * qty),
    source: "rule",
    rule_id: rule.id,
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
      return { key: String(l.key ?? ""), label: String(l.label ?? ""), amount, qty, subtotal: round2(amount * qty), source: "manual" };
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
        label: `Montura ${item.title ?? sku ?? brand ?? ""}`.trim(),
        amount: 0,
        qty,
        subtotal: 0,
        source: "rule",
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
      else lines.push({ key: `${kind}:${code}`, label: `${KIND_LABEL[kind]} ${code}`, amount: 0, qty, subtotal: 0, source: "rule", undefined_cost: true });
    }
  }

  const active = rules.filter((r) => r.active);
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
    lines.push({ key: `order_percent:${SELLER_COMMISSION_KEY}`, label: `Comisión del vendedor (${num(seller.commission_pct)}%)`, amount, qty: 1, subtotal: amount, source: "seller" });
  }

  const cost_total = round2(lines.reduce((a, l) => a + l.subtotal, 0));
  const margin = round2(revenue - cost_total);
  return { lines, cost_total, revenue, margin, margin_pct: revenue > 0 ? round2((margin / revenue) * 100) : 0, manual: false };
}

/** Lines that matched a rule whose amount is still 0. */
export function undefinedCostCount(sheet: CostSheet): number {
  return sheet.lines.filter((l) => l.undefined_cost).length;
}

/** Kind of a line from its key (for the by-kind breakdown). */
export function lineKind(line: CostLine): string {
  const [head] = line.key.split(":");
  if (head === "frame") return "frame";
  if (line.source === "seller") return "seller_commission";
  return head || "other";
}

export const LINE_KIND_LABEL: Record<string, string> = {
  frame: "Monturas",
  lens_design: "Lentes (diseño)",
  lens_material: "Lentes (material)",
  lens_photo: "Fotocromáticos",
  lens_ar: "Antirreflejos",
  order_fixed: "Costos por pedido",
  order_percent: "Comisiones de cobro",
  payment_fixed: "Comisión fija de pago",
  shipping: "Envío",
  seller_commission: "Comisión de vendedores",
  manual: "Ajustes manuales",
  other: "Otros",
};

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
): Promise<{ rules: CostRule[]; sellerByCode: Map<string, { commission_pct: number }> }> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  let rules: CostRule[] = [];
  const sellerByCode = new Map<string, { commission_pct: number }>();
  try {
    rules = await listCostRules(container);
  } catch (error) {
    logger.warn(`[costing] rules unavailable: ${(error as Error).message}`);
  }
  try {
    for (const s of await listSellers(container)) sellerByCode.set(s.code, { commission_pct: s.commission_pct });
  } catch (error) {
    logger.warn(`[costing] sellers unavailable: ${(error as Error).message}`);
  }
  return { rules, sellerByCode };
}
