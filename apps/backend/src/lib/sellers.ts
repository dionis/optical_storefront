import crypto from "crypto";
import type { MedusaContainer } from "@medusajs/framework/types";
import { SELLER_MODULE } from "../modules/seller/index";
import type SellerModuleService from "../modules/seller/service";
import { storefrontOrigin } from "./order-access";
import { normalizeSellerCodeLoose, normalizeSellerSourceLoose } from "./order-board";
import { referralSourcesByOrder, sellerFactOrders, type AnalyticsFilter } from "./sales-analytics";

/**
 * Sellers (vendedores): referral codes, dashboard links and sales stats.
 *
 * Pure helpers first (code derivation, token signing — tested without a
 * database), container helpers after. The module service itself is plain CRUD
 * (`src/modules/seller`).
 */

// ── Codes ────────────────────────────────────────────────────────────────────

export const SELLER_CODE_MIN = 3;
export const SELLER_CODE_MAX = 12;
const CODE_RE = /^[A-Z0-9]{3,12}$/;

/**
 * Admin-entered code → canonical form (uppercase, A-Z0-9 only), or null when
 * the result is not a valid code. Accents are folded ("ÁNGEL" → "ANGEL") and
 * separators dropped ("ana-g" → "ANAG").
 */
export function normalizeSellerCode(value: unknown): string | null {
  const s = String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return CODE_RE.test(s) ? s : null;
}

export function isValidSellerCode(value: unknown): value is string {
  return typeof value === "string" && CODE_RE.test(value);
}

// ── Traffic source (which network brought the sale) ──────────────────────────

/**
 * Sources the storefront can tag a referral with (`?ref=CODE&src=<source>` →
 * `cart.metadata.seller_source` → `order.metadata`). `link` is the plain
 * referral link with no network behind it, and the fallback for orders that
 * carry a seller code but no source.
 */
export const SELLER_SOURCES = ["instagram", "facebook", "tiktok", "whatsapp", "telegram", "x", "email", "link", "other"] as const;
export type SellerSource = (typeof SELLER_SOURCES)[number];
export const DEFAULT_SELLER_SOURCE: SellerSource = "link";
/**
 * Source of a sale rung up at the till (`sale_fact.channel = "pos"`): not a
 * network, so not in `SELLER_SOURCES` (no referral link is built for it), but
 * a row of `by_source` like the others so the panel shows where every sale
 * of a seller came from — counter or web.
 */
export const COUNTER_SOURCE = "counter";

/**
 * Source token as the cart carried it: lowercase a-z only, at most 20 chars,
 * null when empty. Lenient like `normalizeSellerCodeLoose` — unknown tokens
 * are kept (the stats group them as they come), never rejected.
 */
export function normalizeSellerSource(value: unknown): string | null {
  return normalizeSellerSourceLoose(value);
}

/**
 * Derive a code from a person's name: the first name (letters only, up to the
 * max), padded with the surname's initial and a counter until it is free.
 *   "Ana García"  → "ANA"   ("ANAG", "ANAG2", … when taken)
 *   "Jo"          → "JOX"   (too short → padded)
 */
export function deriveSellerCode(name: unknown, taken: Set<string> = new Set()): string {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ");
  const words = fold(String(name ?? "")).split(/\s+/).filter(Boolean);
  let base = (words[0] ?? "").slice(0, SELLER_CODE_MAX);
  if (!base) base = "VEND";
  while (base.length < SELLER_CODE_MIN) base += "X";
  const isFree = (c: string) => !taken.has(c);
  if (isFree(base)) return base;

  const initial = (words[1] ?? "")[0] ?? "";
  const withInitial = initial && base.length < SELLER_CODE_MAX ? base + initial : base;
  if (withInitial !== base && isFree(withInitial)) return withInitial;

  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const stem = withInitial.slice(0, SELLER_CODE_MAX - suffix.length);
    const candidate = stem + suffix;
    if (isFree(candidate)) return candidate;
  }
  // Practically unreachable; a random tail keeps the invariant.
  return (withInitial.slice(0, 8) + crypto.randomBytes(2).toString("hex").toUpperCase()).slice(0, SELLER_CODE_MAX);
}

// ── Dashboard link tokens ────────────────────────────────────────────────────

/**
 * Signing key for seller dashboard links. Its own var so it can be rotated
 * without logging every shopper out of order tracking; falls back to the
 * order-access secret chain so an un-configured deployment still works.
 */
function secret(): string {
  const value =
    process.env.SELLER_LINK_SECRET ||
    process.env.ORDER_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    process.env.COOKIE_SECRET ||
    "";
  if (!value) throw new Error("SELLER_LINK_SECRET (or ORDER_ACCESS_SECRET) must be set to sign seller links.");
  return value;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(body).digest());
}

export interface SellerTokenPayload {
  /** Seller id. */
  sid: string;
  /** token_version the link was issued for. */
  v: number;
  /** Purpose tag — never interchangeable with order-access tokens. */
  p: "seller";
}

/**
 * No expiry on purpose: the link lives in the seller's bookmarks for months.
 * Revocation is `token_version` on the row (rotate-link), not a clock.
 */
export function signSellerToken(sellerId: string, tokenVersion: number): string {
  const payload: SellerTokenPayload = { sid: String(sellerId), v: Math.max(1, Math.floor(Number(tokenVersion) || 1)), p: "seller" };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Payload when the signature holds, null otherwise (version is checked by the caller against the row). */
export function verifySellerToken(token: unknown): SellerTokenPayload | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!body || !signature) return null;
  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: SellerTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SellerTokenPayload;
  } catch {
    return null;
  }
  if (!payload || payload.p !== "seller" || typeof payload.sid !== "string" || !payload.sid) return null;
  if (typeof payload.v !== "number" || !Number.isFinite(payload.v)) return null;
  return { sid: payload.sid, v: payload.v, p: "seller" };
}

// ── Rows and links ───────────────────────────────────────────────────────────

export interface SellerSocial {
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  whatsapp?: string | null;
}

export interface SellerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  address_separate: boolean;
  code: string;
  commission_pct: number;
  active: boolean;
  /** Store the seller works from; always set while active. */
  establishment_id: string | null;
  /** Till (punto de venta) inside that store; always set while active. */
  terminal_id: string | null;
  /** Equipo user who sells at the counter as this seller; null = referral only. */
  user_id: string | null;
  notes: string | null;
  token_version: number;
  social: SellerSocial | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  deleted_at?: string | Date | null;
}

export interface SellerLinks {
  referral_url: string;
  dashboard_url: string;
  /** One referral link per network, tagged with `src=` so the sale is attributed to it. */
  social_links: Record<SellerSource, string>;
}

export interface Seller extends SellerRow, SellerLinks {}

export function sellerLinks(seller: Pick<SellerRow, "id" | "code" | "token_version">): SellerLinks {
  const origin = storefrontOrigin();
  const referral_url = `${origin}/?ref=${encodeURIComponent(seller.code)}`;
  const social_links = {} as Record<SellerSource, string>;
  for (const source of SELLER_SOURCES) {
    social_links[source] = source === DEFAULT_SELLER_SOURCE ? referral_url : `${referral_url}&src=${source}`;
  }
  return {
    referral_url,
    dashboard_url: `${origin}/vendedor?t=${encodeURIComponent(signSellerToken(seller.id, seller.token_version))}`,
    social_links,
  };
}

const SOCIAL_KEYS: Array<keyof SellerSocial> = ["instagram", "facebook", "tiktok", "whatsapp"];

/** Keep only the four known handles, trimmed; null when none. */
export function normalizeSocial(value: unknown): SellerSocial | null {
  if (!value || typeof value !== "object") return null;
  const out: SellerSocial = {};
  let any = false;
  for (const k of SOCIAL_KEYS) {
    const v = (value as Record<string, unknown>)[k];
    const s = typeof v === "string" ? v.trim().slice(0, 200) : "";
    if (s) {
      out[k] = s;
      any = true;
    }
  }
  return any ? out : null;
}

/** Row from the module → API shape (numbers as numbers, links attached). */
export function projectSeller(row: Record<string, unknown>): Seller {
  const base: SellerRow = {
    id: String(row["id"]),
    name: String(row["name"] ?? ""),
    email: (row["email"] as string | null) ?? null,
    phone: (row["phone"] as string | null) ?? null,
    address: (row["address"] as string | null) ?? null,
    address_separate: row["address_separate"] === true,
    code: String(row["code"] ?? "").toUpperCase(),
    commission_pct: Number(row["commission_pct"] ?? 0) || 0,
    active: row["active"] !== false,
    establishment_id: (row["establishment_id"] as string | null) ?? null,
    terminal_id: (row["terminal_id"] as string | null) ?? null,
    user_id: (row["user_id"] as string | null) ?? null,
    notes: (row["notes"] as string | null) ?? null,
    token_version: Math.max(1, Number(row["token_version"] ?? 1) || 1),
    social: normalizeSocial(row["social"]),
    created_at: (row["created_at"] as string | null) ?? null,
    updated_at: (row["updated_at"] as string | null) ?? null,
  };
  return { ...base, ...sellerLinks(base) };
}

/** Commission percentage: finite, 0–100, two decimals; null when invalid. */
export function parseCommissionPct(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(String(value).replace("%", "").trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

// ── Store and till ───────────────────────────────────────────────────────────

export type SellerPlacementReason =
  | "store_required"
  | "terminal_required"
  | "store_unknown"
  | "store_inactive"
  | "terminal_unknown"
  | "terminal_wrong_store"
  | "terminal_inactive";

/**
 * Owner's rule: a seller always belongs to a store and, while ACTIVE, sells
 * from exactly one till of that store (both live). An inactive seller may have
 * neither, so any other field can be saved while deactivated — but whatever is
 * set must still be coherent (a till always inside the chosen store).
 *
 * `seller` is the state AFTER the save (current row merged with the body), so
 * activating a seller without a store is refused the same as clearing it.
 */
export function sellerPlacementProblem(
  seller: { active: boolean; establishment_id: string | null; terminal_id: string | null },
  stores: Array<{ id: string; is_active: boolean }>,
  terminals: Array<{ id: string; establishment_id: string; is_active: boolean }>
): SellerPlacementReason | null {
  const { active, establishment_id, terminal_id } = seller;
  if (terminal_id && !establishment_id) return "store_required";
  const store = establishment_id ? stores.find((s) => s.id === establishment_id) : undefined;
  if (establishment_id && !store) return "store_unknown";
  const till = terminal_id ? terminals.find((t) => t.id === terminal_id) : undefined;
  if (terminal_id && !till) return "terminal_unknown";
  if (till && till.establishment_id !== establishment_id) return "terminal_wrong_store";
  if (!active) return null;
  if (!store) return "store_required";
  if (!store.is_active) return "store_inactive";
  if (!till) return "terminal_required";
  if (!till.is_active) return "terminal_inactive";
  return null;
}

// ── Panel user (Equipo) ↔ seller ─────────────────────────────────────────────

/**
 * How a user with the `seller` role gets their seller record, as the Equipo
 * tab sends it: an existing one (`seller_id`) or a new one created with the
 * user (store and till required — a new counter seller is active).
 */
export type SellerLinkInput =
  | { seller_id: string }
  | { create: { establishment_id: string; terminal_id: string; commission_pct: number; code: string | null } };

export type SellerLinkReason = "seller_link_required" | "seller_not_found" | "seller_taken" | "seller_inactive" | "commission_invalid" | SellerPlacementReason;

export function parseSellerLink(raw: unknown): SellerLinkInput | { reason: SellerLinkReason } {
  if (!raw || typeof raw !== "object") return { reason: "seller_link_required" };
  const r = raw as Record<string, unknown>;
  const id = typeof r["seller_id"] === "string" ? r["seller_id"].trim() : "";
  if (id) return { seller_id: id };
  const c = r["create"];
  if (!c || typeof c !== "object") return { reason: "seller_link_required" };
  const cc = c as Record<string, unknown>;
  const establishment_id = typeof cc["establishment_id"] === "string" ? cc["establishment_id"].trim() : "";
  const terminal_id = typeof cc["terminal_id"] === "string" ? cc["terminal_id"].trim() : "";
  if (!establishment_id) return { reason: "store_required" };
  if (!terminal_id) return { reason: "terminal_required" };
  const pct = parseCommissionPct(cc["commission_pct"]);
  if (pct === null) return { reason: "commission_invalid" };
  const code = String(cc["code"] ?? "").trim() || null;
  return { create: { establishment_id, terminal_id, commission_pct: pct, code } };
}

/**
 * Can `userId` take this existing seller? It must be free (or already theirs)
 * and ACTIVE — an active seller always has store and till, which is what the
 * counter needs.
 */
export function sellerLinkProblem(
  seller: Pick<SellerRow, "user_id" | "active"> | null,
  userId: string | null
): SellerLinkReason | null {
  if (!seller) return "seller_not_found";
  if (seller.user_id && seller.user_id !== userId) return "seller_taken";
  if (!seller.active) return "seller_inactive";
  return null;
}

export function sellerService(container: MedusaContainer): SellerModuleService {
  return container.resolve<SellerModuleService>(SELLER_MODULE);
}

/** Live sellers, sorted by name. */
export async function listSellers(container: MedusaContainer): Promise<Seller[]> {
  const svc = sellerService(container);
  const rows = (await svc.listSellers({}, { take: 500 })) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => !r["deleted_at"])
    .map(projectSeller)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** One live seller by code (uppercase match), or null. */
export async function findSellerByCode(container: MedusaContainer, code: unknown): Promise<Seller | null> {
  const c = normalizeSellerCodeLoose(code);
  if (!c) return null;
  const svc = sellerService(container);
  const rows = (await svc.listSellers({ code: c }, { take: 1 })) as unknown as Record<string, unknown>[];
  const row = rows.find((r) => !r["deleted_at"]);
  return row ? projectSeller(row) : null;
}

/** One live seller by id, or null. */
export async function findSellerById(container: MedusaContainer, id: string): Promise<Seller | null> {
  const svc = sellerService(container);
  const rows = (await svc.listSellers({ id }, { take: 1 })) as unknown as Record<string, unknown>[];
  const row = rows.find((r) => !r["deleted_at"]);
  return row ? projectSeller(row) : null;
}

// ── Stats ────────────────────────────────────────────────────────────────────

/** Terminal states (canceled / refunded / payment pending / voided) earn nobody anything. */
export function countsForRevenue(order: { terminal?: string | null }): boolean {
  return !order.terminal;
}

export interface SourceStatRow {
  source: string;
  orders: number;
  revenue: number;
}

/** Monthly goal progress of a seller (HU-40), dollars; `done` is the NET of the current month, like the commission. */
export interface SellerGoal {
  amount: number;
  done: number;
  left: number;
  /** 0–100, capped at 100, one decimal. */
  pct: number;
}

/**
 * Pure: a seller's progress towards their monthly goal from this month's net
 * in cents (sale_fact `total − tax`, the commission base — never the gross,
 * so the goal and the commission move together). Null without a goal.
 */
export function goalProgress(amount: number | null | undefined, doneCents: number): SellerGoal | null {
  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return null;
  const goal = round2(Number(amount));
  const done = round2(Math.max(0, Math.round(doneCents)) / 100);
  return { amount: goal, done, left: round2(Math.max(0, goal - done)), pct: Math.min(100, round1((done / goal) * 100)) };
}

export interface SellerStatRow {
  id: string;
  code: string;
  name: string;
  commission_pct: number;
  active: boolean;
  /** Panel user linked to the record (their profile holds the monthly goal); null for a referral-only seller. */
  user_id: string | null;
  /** Progress towards the monthly goal (HU-40); null without a goal or a user. Filled by the route, not here. */
  goal: SellerGoal | null;
  orders: number;
  /** What the customers paid (tax and shipping included) — the sales figure. */
  revenue: number;
  /** Commission base: revenue less sales tax and shipping (`netRevenueOf`). */
  net_revenue: number;
  /** Σ per sale of `saleCommission` (the % of each line's net, rounded per line). */
  commission: number;
  /** Items sold (line quantities). */
  units: number;
  /** Revenue over orders; 0 without orders. */
  avg_ticket: number;
  /** Gross profit of those orders (lib/sales-insights.ts); null when the caller may not see it. */
  profit: number | null;
  /** Profit over orders; null with the profit. */
  avg_profit: number | null;
  /** % of every sale in the window (attributed or not) — the seller's quota. */
  share_pct: number;
  last_order_at: string | null;
  /** Where this seller's sales came from (orders without a source → "link"). */
  by_source: SourceStatRow[];
}

export interface SellerStats {
  from: string | null;
  to: string | null;
  sellers: SellerStatRow[];
  unattributed: { orders: number; revenue: number };
  /** Across every attributed (seller-matched) order in the window. */
  sources: SourceStatRow[];
  /** Whether `profit` / `avg_profit` carry a figure for this caller. */
  access: { profit: boolean };
  truncated: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Source of an order for the stats: "counter" for a till sale, else the
 * stored referral token, or "link" when none.
 */
export function sellerSourceOf(order: { seller_source?: string | null; channel?: string | null }): string {
  if (order.channel === "pos") return COUNTER_SOURCE;
  return normalizeSellerSource(order.seller_source) ?? DEFAULT_SELLER_SOURCE;
}

/** Add an order to a per-source tally (mutates the map). */
function tallySource(map: Map<string, SourceStatRow>, source: string, total: number): void {
  const row = map.get(source) ?? { source, orders: 0, revenue: 0 };
  row.orders++;
  row.revenue = round2(row.revenue + total);
  map.set(source, row);
}

/** Map → array, biggest revenue first (then alphabetically, so ties are stable). */
export function sortedSources(map: Map<string, SourceStatRow> | SourceStatRow[]): SourceStatRow[] {
  return [...(Array.isArray(map) ? map : map.values())].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.source.localeCompare(b.source));
}

/** ISO string of a board `created_at` (which may arrive as a Date); "" when absent. */
export function isoAt(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * One sale as the stats read it. Built from `sale_fact` (one row per order,
 * `sellerFactOrders`); board rows fit the same shape, which is what the pure
 * tests use.
 */
export type StatOrder = {
  id?: string;
  /** Referral code of a web order, or the till seller's receipt code. */
  seller_code?: string | null;
  /** Panel user who rang the sale up at the till (`sale_fact.seller_id`); null on a web order. */
  seller_id?: string | null;
  /** "pos" for a till sale, "web" for the online store; absent = web. */
  channel?: string | null;
  total: unknown;
  /** Set on a terminal / voided sale: earns nobody anything. */
  terminal?: string | null;
  created_at: unknown;
  seller_source?: string | null;
  items?: Array<{ quantity?: number | null }>;
  /** Items sold, when already summed (sale_fact `qty`); else counted from `items`. */
  units?: number | null;
  /** Sales tax and shipping the customer paid: out of the commission base (see `netRevenueOf`). */
  tax_total?: unknown;
  shipping_total?: unknown;
  /** Net of each line in cents (sale_fact): the commission is rounded per line, as the Executive does. */
  net_cents_lines?: number[] | null;
};

/** Sellers as the grouping needs them: the record's code, and the panel user who sells at the till as it. */
export type StatSeller = Pick<Seller, "id" | "code" | "name" | "commission_pct" | "active"> & { user_id?: string | null };

/**
 * Which seller a sale belongs to. The person who rang it up at the till wins
 * (`seller_id` = the record's `user_id`): that is who earns the commission,
 * whatever code the receipt printed. Otherwise the code on the sale (a web
 * referral, or a till sale of a user with no record). One sale, one seller:
 * a sale that matches the same record both ways is still counted once, and
 * a sale whose user is one record and whose code is another goes to the
 * user. Pure.
 */
export function attributeSale(sale: Pick<StatOrder, "seller_id" | "seller_code">, byUser: Map<string, string>, byCode: Map<string, unknown>): string | null {
  const viaUser = sale.seller_id ? byUser.get(sale.seller_id) : undefined;
  if (viaUser) return viaUser;
  const code = normalizeSellerCodeLoose(sale.seller_code);
  return code && byCode.has(code) ? code : null;
}

/**
 * Commission base of an order: what the customer paid LESS the sales tax and
 * the shipping. Neither is the store's money — the tax belongs to the state
 * and the shipping to the courier — so neither earns a commission.
 *
 * This is the same base as everywhere else: `lineEconomics` takes
 * `total − tax` of each line (sale_fact has no shipping line at all),
 * `store-pnl.ts` the same, and `/admin/sales-analytics/me` shows the seller
 * `(total − tax) × pct`. Paying on the gross would hand every seller the
 * commission of the state's tax as well. Dollars in, dollars out. Pure.
 */
export function netRevenueOf(order: Pick<StatOrder, "total" | "tax_total" | "shipping_total">): number {
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return round2(Math.max(0, num(order.total) - num(order.tax_total) - num(order.shipping_total)));
}

/**
 * Commission of ONE sale in dollars: the % of the net of each of its lines,
 * each rounded to the cent (`Math.round(net × pct / 100)`), then added — the
 * very arithmetic of lib/sales-insights.ts lineEconomics, so Vendedores and
 * Ejecutivo → Vendedores print the same cents for the same seller. Without the
 * line nets (a board row, an old caller) the order's net is rounded once.
 * Rounding once over a MONTH instead (what this did until 5-nov-2026) drifted
 * a cent from the Executive as soon as two sales had half-cent fractions:
 * two nets of $71.33 at 8 % are $5.71 + $5.71 = $11.42 per line, $11.41 in
 * one go. Pure.
 */
export function saleCommission(order: Pick<StatOrder, "total" | "tax_total" | "shipping_total" | "net_cents_lines">, pct: number): number {
  if (!pct) return 0;
  const lines = order.net_cents_lines;
  if (Array.isArray(lines) && lines.length) return lines.reduce((s, net) => s + Math.round((Math.max(0, net) * pct) / 100), 0) / 100;
  return round2((netRevenueOf(order) * pct) / 100);
}

/**
 * Pure grouping: sales × sellers → per-seller totals. Each sale goes to ONE
 * seller (`attributeSale`: the till user first, then the code), so a counter
 * seller's till sales and a referral seller's web orders both count and
 * nothing is counted twice. Sales in a terminal state (canceled / refunded /
 * payment pending / voided) count for nobody. Every seller is listed, with
 * zeros when they sold nothing, biggest revenue first. `profitByOrder`
 * (dollars per order id, lib/sales-insights.ts) fills `profit`/`avg_profit`;
 * without it they stay null (the caller may not see them). `share_pct` is the
 * seller's part of EVERY sale in the window, attributed or not: the quota.
 *
 * `revenue` is what the customers paid; `commission` is the percentage of
 * `net_revenue` (revenue less sales tax and shipping, `netRevenueOf`) — the
 * same base as the store result and the seller's own panel.
 */
export function groupSellerStats(
  orders: StatOrder[],
  sellers: StatSeller[],
  profitByOrder: Map<string, number> | null = null
): { sellers: SellerStatRow[]; unattributed: { orders: number; revenue: number }; sources: SourceStatRow[] } {
  const byCode = new Map<string, SellerStatRow>();
  const byUser = new Map<string, string>();
  const sourcesByCode = new Map<string, Map<string, SourceStatRow>>();
  const profitOf = new Map<string, number>();
  for (const s of sellers) {
    if (s.user_id && !byUser.has(s.user_id)) byUser.set(s.user_id, s.code.toUpperCase());
    byCode.set(s.code.toUpperCase(), {
      id: s.id,
      code: s.code.toUpperCase(),
      name: s.name,
      commission_pct: s.commission_pct,
      active: s.active,
      user_id: s.user_id ?? null,
      goal: null,
      orders: 0,
      revenue: 0,
      net_revenue: 0,
      commission: 0,
      units: 0,
      avg_ticket: 0,
      profit: null,
      avg_profit: null,
      share_pct: 0,
      last_order_at: null,
      by_source: [],
    });
    sourcesByCode.set(s.code.toUpperCase(), new Map());
  }
  const unattributed = { orders: 0, revenue: 0 };
  const allSources = new Map<string, SourceStatRow>();
  for (const o of orders) {
    if (!countsForRevenue(o)) continue;
    const code = attributeSale(o, byUser, byCode);
    const row = code ? byCode.get(code) : undefined;
    const total = Number(o.total ?? 0) || 0;
    if (!row) {
      unattributed.orders++;
      unattributed.revenue = round2(unattributed.revenue + total);
      continue;
    }
    row.orders++;
    row.revenue = round2(row.revenue + total);
    row.net_revenue = round2(row.net_revenue + netRevenueOf(o));
    row.commission = round2(row.commission + saleCommission(o, row.commission_pct));
    row.units += o.units != null ? Number(o.units) || 0 : (o.items ?? []).reduce((n, it) => n + (Number(it?.quantity ?? 1) || 0), 0);
    if (profitByOrder && o.id !== undefined) profitOf.set(row.code, round2((profitOf.get(row.code) ?? 0) + (profitByOrder.get(o.id) ?? 0)));
    const at = isoAt(o.created_at) || null;
    if (at && (!row.last_order_at || at > row.last_order_at)) row.last_order_at = at;
    const source = sellerSourceOf(o);
    tallySource(sourcesByCode.get(row.code)!, source, total);
    tallySource(allSources, source, total);
  }
  const everything = round2([...byCode.values()].reduce((s, r) => s + r.revenue, 0) + unattributed.revenue);
  for (const row of byCode.values()) {
    // `commission` was added sale by sale above (saleCommission): of the NET,
    // never of the gross, and rounded per line like the Executive.
    row.avg_ticket = row.orders ? round2(row.revenue / row.orders) : 0;
    if (profitByOrder) {
      row.profit = profitOf.get(row.code) ?? 0;
      row.avg_profit = row.orders ? round2(row.profit / row.orders) : 0;
    }
    row.share_pct = everything > 0 ? round1((row.revenue / everything) * 100) : 0;
    row.by_source = sortedSources(sourcesByCode.get(row.code) ?? new Map());
  }
  return {
    sellers: [...byCode.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.name.localeCompare(b.name, "es")),
    unattributed,
    sources: sortedSources(allSources),
  };
}

/**
 * The local-day analytics filter of a stats period (`from`/`to` ISO instants
 * or null, as the route and start-map pass them): what `sellerFactOrders`
 * and lib/sales-insights.ts orderEconomics take — the Executive's own filter,
 * so both screens read the same sales. Without `to`, tomorrow (UTC) so no
 * local day is cut off. Pure.
 */
export function statsDayFilter(range: { from?: string | null; to?: string | null; store?: string | null }, now = new Date()): AnalyticsFilter {
  const day = (v: string | null | undefined, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : fallback);
  const tomorrow = new Date(now.getTime() + 86400_000).toISOString().slice(0, 10);
  const store = range.store && range.store !== "all" ? range.store : null;
  return { from: day(range.from, "2000-01-01"), to: day(range.to, tomorrow), stores: store ? [store] : null };
}

/** Gross profit per order id, in dollars (the route passes lib/sales-insights.ts orderEconomics; sellers.ts does not import it: costing.ts already imports this file). */
export type ProfitLoader = (filter: AnalyticsFilter, orderIds: string[]) => Promise<Map<string, { profit: number }>>;

/**
 * Stats over `sale_fact` — the source of truth every other sales screen reads
 * (Executive, store result, statements), with the same local-day and store
 * filter (`statsDayFilter` → `applyFilter`). Till sales are attributed by the
 * user who rang them up (`seller.user_id`), web orders by the referral code
 * (`attributeSale`); until 5-nov-2026 this read the order board's
 * `metadata.seller_code` only, so a counter seller showed $0 while the
 * Executive attributed their sales. `store`: one establishment's till sales,
 * or "web" for the online store; empty = everything. With `profitLoader`
 * (only when the caller may see profit, insightAccess) each seller gets the
 * gross profit of their orders, from the same rules as the Executive.
 * `truncated` only past `MAX_SELLER_STAT_ORDERS` sales in the period.
 */
export async function sellerStats(
  container: MedusaContainer,
  range: { from?: string | null; to?: string | null; store?: string | null },
  profitLoader: ProfitLoader | null = null
): Promise<SellerStats> {
  const filter = statsDayFilter(range);
  const [sellers, facts] = await Promise.all([listSellers(container), sellerFactOrders(container, filter)]);
  // The network behind a web referral lives on the order, not in sale_fact.
  const sources = await referralSourcesByOrder(
    container,
    facts.orders.filter((o) => o.channel === "web" && o.seller_code).map((o) => o.order_id)
  );
  const orders: StatOrder[] = facts.orders.map((o) => ({
    id: o.order_id,
    seller_code: o.seller_code,
    seller_id: o.seller_id,
    channel: o.channel,
    total: o.total,
    tax_total: o.tax,
    shipping_total: 0,
    net_cents_lines: o.net_cents_lines,
    terminal: null,
    created_at: o.sold_at,
    seller_source: sources.get(o.order_id) ?? null,
    units: o.units,
  }));
  let profitByOrder: Map<string, number> | null = null;
  if (profitLoader) {
    const byUser = new Map(sellers.filter((s) => s.user_id).map((s) => [s.user_id as string, s.code]));
    const byCode = new Map(sellers.map((s) => [s.code, true]));
    const ids = orders.filter((o) => attributeSale(o, byUser, byCode)).map((o) => o.id as string);
    const econ = await profitLoader(filter, ids);
    profitByOrder = new Map([...econ].map(([id, e]) => [id, e.profit / 100]));
  }
  const grouped = groupSellerStats(orders, sellers, profitByOrder);
  return {
    from: range.from ?? null,
    to: range.to ?? null,
    ...grouped,
    access: { profit: profitLoader !== null },
    truncated: facts.truncated,
  };
}

// ── The seller's public dashboard (/store/seller-dashboard) ──────────────────

/** A sale as the dashboard sums it: `sale_fact` per order, with its local day. */
export type DashboardOrder = StatOrder & { id: string; sold_date_local: string };

export interface DashboardTotals {
  orders: number;
  /** What the customers paid, tax included (dollars). */
  revenue: number;
  /** The commission base: revenue less sales tax (dollars). */
  net_revenue: number;
  /** Σ `saleCommission` — per line, like the Executive and Vendedores (dollars). */
  commission: number;
}

/**
 * The dashboard's figures from the seller's sales, pure: `period` is the
 * sales whose LOCAL day falls in [from, to] (the same `sold_date_local` every
 * dashboard buckets on), `all_time` every sale given, `by_source` the period
 * by network (counter / instagram / link…), each with its commission. The
 * caller passes only sales already attributed to this seller (`attributeSale`
 * with the same maps `groupSellerStats` builds), so what the seller reads here
 * is exactly their row of Vendedores: same sales, same base, same rounding.
 */
export function dashboardFigures(orders: readonly DashboardOrder[], pct: number, range: { from: string; to: string }): { period: DashboardTotals; all_time: DashboardTotals; by_source: Array<SourceStatRow & { commission: number }>; in_period: DashboardOrder[] } {
  const sum = (rows: readonly DashboardOrder[]): DashboardTotals => {
    let revenue = 0;
    let net = 0;
    let commission = 0;
    for (const o of rows) {
      revenue += Number(o.total ?? 0) || 0;
      net += netRevenueOf(o);
      commission += saleCommission(o, pct);
    }
    return { orders: rows.length, revenue: round2(revenue), net_revenue: round2(net), commission: round2(commission) };
  };
  const inPeriod = orders.filter((o) => o.sold_date_local >= range.from && o.sold_date_local <= range.to);
  const bySource = new Map<string, SourceStatRow & { commission: number }>();
  for (const o of inPeriod) {
    const source = sellerSourceOf(o);
    const row = bySource.get(source) ?? { source, orders: 0, revenue: 0, commission: 0 };
    row.orders++;
    row.revenue = round2(row.revenue + (Number(o.total ?? 0) || 0));
    row.commission = round2(row.commission + saleCommission(o, pct));
    bySource.set(source, row);
  }
  return {
    period: sum(inPeriod),
    all_time: sum(orders),
    by_source: sortedSources([...bySource.values()]).map((r) => bySource.get(r.source)!),
    in_period: [...inPeriod].sort((a, b) => (a.sold_date_local < b.sold_date_local ? 1 : a.sold_date_local > b.sold_date_local ? -1 : String(b.created_at).localeCompare(String(a.created_at)))),
  };
}

/** Current calendar month in UTC, as ISO bounds — the dashboard's default period. */
export function currentMonthRange(now = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString();
  const to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
  return { from, to };
}

/** "Ana García Pérez" → "A. G. P." — the only customer identity a seller sees. */
export function customerInitials(name: unknown): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  return parts.map((p) => `${p[0].toUpperCase()}.`).join(" ");
}
