import crypto from "crypto";
import type { MedusaContainer } from "@medusajs/framework/types";
import { SELLER_MODULE } from "../modules/seller/index";
import type SellerModuleService from "../modules/seller/service";
import { storefrontOrigin } from "./order-access";
import { normalizeSellerCodeLoose, scanBoardWindow, type BoardOrder } from "./order-board";

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
  code: string;
  commission_pct: number;
  active: boolean;
  notes: string | null;
  token_version: number;
  social: SellerSocial | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  deleted_at?: string | Date | null;
}

export interface Seller extends SellerRow {
  referral_url: string;
  dashboard_url: string;
}

export function sellerLinks(seller: Pick<SellerRow, "id" | "code" | "token_version">): { referral_url: string; dashboard_url: string } {
  const origin = storefrontOrigin();
  return {
    referral_url: `${origin}/?ref=${encodeURIComponent(seller.code)}`,
    dashboard_url: `${origin}/vendedor?t=${encodeURIComponent(signSellerToken(seller.id, seller.token_version))}`,
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
    code: String(row["code"] ?? "").toUpperCase(),
    commission_pct: Number(row["commission_pct"] ?? 0) || 0,
    active: row["active"] !== false,
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

/** Terminal states that earn nobody anything. */
export function countsForRevenue(order: Pick<BoardOrder, "terminal">): boolean {
  return !order.terminal;
}

export interface SellerStatRow {
  id: string;
  code: string;
  name: string;
  commission_pct: number;
  active: boolean;
  orders: number;
  revenue: number;
  commission: number;
  last_order_at: string | null;
}

export interface SellerStats {
  from: string | null;
  to: string | null;
  sellers: SellerStatRow[];
  unattributed: { orders: number; revenue: number };
  truncated: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ISO string of a board `created_at` (which may arrive as a Date); "" when absent. */
export function isoAt(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Pure grouping: board-like rows × sellers → per-seller totals. Orders in a
 * terminal state (canceled / refunded / payment pending) count for nobody.
 * Every seller is listed, with zeros when they sold nothing.
 */
export function groupSellerStats(
  orders: Array<Pick<BoardOrder, "seller_code" | "total" | "terminal" | "created_at">>,
  sellers: Array<Pick<Seller, "id" | "code" | "name" | "commission_pct" | "active">>
): { sellers: SellerStatRow[]; unattributed: { orders: number; revenue: number } } {
  const byCode = new Map<string, SellerStatRow>();
  for (const s of sellers) {
    byCode.set(s.code.toUpperCase(), {
      id: s.id,
      code: s.code.toUpperCase(),
      name: s.name,
      commission_pct: s.commission_pct,
      active: s.active,
      orders: 0,
      revenue: 0,
      commission: 0,
      last_order_at: null,
    });
  }
  const unattributed = { orders: 0, revenue: 0 };
  for (const o of orders) {
    if (!countsForRevenue(o)) continue;
    const code = normalizeSellerCodeLoose(o.seller_code);
    const row = code ? byCode.get(code) : undefined;
    const total = Number(o.total ?? 0) || 0;
    if (!row) {
      unattributed.orders++;
      unattributed.revenue = round2(unattributed.revenue + total);
      continue;
    }
    row.orders++;
    row.revenue = round2(row.revenue + total);
    const at = isoAt(o.created_at) || null;
    if (at && (!row.last_order_at || at > row.last_order_at)) row.last_order_at = at;
  }
  for (const row of byCode.values()) {
    row.commission = round2((row.revenue * row.commission_pct) / 100);
  }
  return {
    sellers: [...byCode.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "es")),
    unattributed,
  };
}

/** Stats over the board window (`MAX_BOARD_SCAN` most recent orders in range). */
export async function sellerStats(
  container: MedusaContainer,
  range: { from?: string | null; to?: string | null }
): Promise<SellerStats> {
  const [sellers, window] = await Promise.all([
    listSellers(container),
    scanBoardWindow(container, { from: range.from ?? undefined, to: range.to ?? undefined }),
  ]);
  const grouped = groupSellerStats(window.orders, sellers);
  return {
    from: range.from ?? null,
    to: range.to ?? null,
    ...grouped,
    truncated: window.truncated,
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
