/**
 * PROMOTIONS PER STORE (owner, 15-nov-2026): «promociones por tienda, configura
 * algunas 5 y que se puedan habilitar o deshabilitar según necesidad, agregar
 * otras, editarlas […] compre 2 lleve 1 gratis, examen de la vista gratis si
 * compra con nosotros […] debe quedar claro qué es descuento y qué es
 * promoción; la promoción se hace por intervalo de tiempo».
 *
 * DISCOUNT ≠ PROMOTION:
 *   - a DISCOUNT is a percentage: the owner's per-article discounts (Productos
 *     y precios → «Descuento −X %», store_item_discount) already in the price,
 *     and the one the seller types at the till (with its limit and approval);
 *   - a PROMOTION is an offer with a name, its stores and its dates, that the
 *     seller picks for the sale when the patient qualifies («Compre 2, lleve 1
 *     gratis», «Examen de la vista gratis con tu compra»…). It is printed by
 *     name on the receipt.
 *
 * Kinds:
 *   percent       X % off the whole sale.
 *   bogo          «compre N, lleve M»: the sale of the pair that comes free (or
 *                 at X %) — the till sells one pair per sale, so it asks for the
 *                 number(s) of the sale(s) the patient paid (`ref`).
 *   free_service  something included at no charge (the eye exam): no money
 *                 changes, the receipt says it (and its value, if set).
 *   gift          an item given with the purchase (case, cleaner): same.
 *
 * Never added together: the sale takes the BIGGER of the seller's discount and
 * the promotion's percentage, and says which one it is. A promotion needs no
 * approval (the owner set it up); a typed discount above the limit still does.
 *
 * Pure: exported for the tests. Stored in `store_promotion` (migration
 * CreateStorePromotion8, lib/promotions-data.ts).
 */
export const PROMO_KINDS = ["percent", "bogo", "free_service", "gift"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];
/** Kinds that change the price of the sale. */
export const MONEY_KINDS: readonly PromoKind[] = ["percent", "bogo"];

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  kind: PromoKind;
  /** null = every store. */
  establishment_ids: string[] | null;
  /** First and last day it runs (store calendar, inclusive); null = no limit on that side. */
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  /** percent and bogo: the percentage off (bogo: on the free / discounted pair). */
  pct: number | null;
  buy_qty: number | null;
  get_qty: number | null;
  /** Minimum list amount of the sale for it to apply (cents); null = none. */
  min_total_cents: number | null;
  /** free_service / gift: what it is worth, printed on the receipt (cents); null = not said. */
  value_cents: number | null;
  sort: number;
}

const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const text = (v: unknown, n: number): string | null => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s ? s.slice(0, n) : null;
};
const intIn = (v: unknown, lo: number, hi: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : Number.NaN;
};
const moneyCents = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? Math.round(n * 100) : Number.NaN;
};

export type PromotionInput = Omit<Promotion, "id" | "sort"> & { sort?: number };

/**
 * A promotion as sent by the panel (money in dollars), checked. `stores` are
 * the active store ids that exist (an unknown id is refused).
 */
export function cleanPromotion(raw: Record<string, unknown>, stores: readonly string[]): { promo: PromotionInput } | { reason: string } {
  const name = text(raw.name, 80);
  if (!name) return { reason: "promo_name_required" };
  const kind = String(raw.kind ?? "") as PromoKind;
  if (!PROMO_KINDS.includes(kind)) return { reason: "bad_promo_kind" };
  const description = text(raw.description, 300);

  let establishment_ids: string[] | null = null;
  if (Array.isArray(raw.establishment_ids) && raw.establishment_ids.length) {
    const ids = [...new Set(raw.establishment_ids.map(String))];
    if (ids.some((id) => !stores.includes(id))) return { reason: "bad_promo_store" };
    establishment_ids = ids;
  }

  const starts_on = raw.starts_on ? String(raw.starts_on) : null;
  const ends_on = raw.ends_on ? String(raw.ends_on) : null;
  const realDay = (d: string) => YMD.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
  if ((starts_on && !realDay(starts_on)) || (ends_on && !realDay(ends_on))) return { reason: "bad_promo_dates" };
  if (starts_on && ends_on && ends_on < starts_on) return { reason: "promo_ends_before_start" };

  let pct: number | null = null;
  let buy_qty: number | null = null;
  let get_qty: number | null = null;
  if (kind === "percent" || kind === "bogo") {
    pct = intIn(raw.pct ?? (kind === "bogo" ? 100 : null), 1, 100);
    if (pct === null || Number.isNaN(pct)) return { reason: "bad_promo_pct" };
  }
  if (kind === "bogo") {
    buy_qty = intIn(raw.buy_qty, 1, 10);
    get_qty = intIn(raw.get_qty, 1, 10);
    if (buy_qty === null || get_qty === null || Number.isNaN(buy_qty) || Number.isNaN(get_qty)) return { reason: "bad_promo_qty" };
  }
  const min_total_cents = moneyCents(raw.min_total);
  if (Number.isNaN(min_total_cents)) return { reason: "bad_promo_min" };
  const value_cents = kind === "free_service" || kind === "gift" ? moneyCents(raw.value) : null;
  if (Number.isNaN(value_cents)) return { reason: "bad_promo_value" };
  const sort = intIn(raw.sort, 0, 9999);

  return {
    promo: {
      name,
      description,
      kind,
      establishment_ids,
      starts_on,
      ends_on,
      is_active: raw.is_active !== false,
      pct,
      buy_qty,
      get_qty,
      min_total_cents,
      value_cents,
      ...(sort !== null && !Number.isNaN(sort) ? { sort } : {}),
    },
  };
}

/** Where a promotion stands today in a store: running, or why not. Pure. */
export function promoState(p: Pick<Promotion, "is_active" | "establishment_ids" | "starts_on" | "ends_on">, today: string, establishmentId?: string | null): "live" | "off" | "scheduled" | "ended" | "other_store" {
  if (!p.is_active) return "off";
  if (establishmentId && p.establishment_ids && !p.establishment_ids.includes(establishmentId)) return "other_store";
  if (p.starts_on && today < p.starts_on) return "scheduled";
  if (p.ends_on && today > p.ends_on) return "ended";
  return "live";
}

/** What the sale records of the promotion it used (receipt, sale detail, reports). */
export interface AppliedPromotion {
  id: string;
  name: string;
  kind: PromoKind;
  pct: number | null;
  buy_qty: number | null;
  get_qty: number | null;
  value_cents: number | null;
  /** bogo: the sale(s) the patient paid. */
  ref: string | null;
  /** Whether its percentage is the one the sale used (false: the seller's discount was bigger). */
  priced: boolean;
}

/**
 * Applying a promotion to a sale whose list amount (before any discount) is
 * `listCents`. `ref` = the paid sales of a «compre N, lleve M». Pure.
 */
export function applyPromotion(p: Promotion, input: { listCents: number; ref?: unknown }): { applied: Omit<AppliedPromotion, "priced"> } | { reason: string; min?: number } {
  if (p.min_total_cents !== null && input.listCents < p.min_total_cents) return { reason: "promo_min_total", min: p.min_total_cents / 100 };
  const ref = text(input.ref, 120);
  if (p.kind === "bogo" && !ref) return { reason: "promo_ref_required" };
  return { applied: { id: p.id, name: p.name, kind: p.kind, pct: MONEY_KINDS.includes(p.kind) ? p.pct : null, buy_qty: p.buy_qty, get_qty: p.get_qty, value_cents: p.value_cents, ref: p.kind === "bogo" ? ref : null } };
}

/**
 * The sale's percentage off: the bigger of the seller's discount and the
 * promotion's, never both. `source` says which one is in the price. Pure.
 */
export function saleDiscountPct(manualPct: number, promoPct: number | null): { pct: number; source: "promotion" | "discount" | null } {
  const promo = promoPct ?? 0;
  if (promo > 0 && promo >= manualPct) return { pct: promo, source: "promotion" };
  if (manualPct > 0) return { pct: manualPct, source: "discount" };
  return { pct: 0, source: null };
}

/**
 * The five promotions every practice starts with (migration
 * CreateStorePromotion8), switched OFF: the owner turns on the ones he wants
 * and sets their dates. Examples of each kind.
 */
export const SEED_PROMOTIONS: Array<Omit<PromotionInput, "establishment_ids" | "starts_on" | "ends_on" | "is_active"> & { sort: number }> = [
  { name: "Compre 2, lleve 1 gratis", description: "Al comprar dos espejuelos completos, el tercero (el de menor precio) va gratis. Se aplica en la venta del par gratis, con los números de las dos ventas pagadas.", kind: "bogo", pct: 100, buy_qty: 2, get_qty: 1, min_total_cents: null, value_cents: null, sort: 1 },
  { name: "Examen de la vista gratis con tu compra", description: "El examen de la vista no se cobra si el paciente compra sus espejuelos con nosotros.", kind: "free_service", pct: null, buy_qty: null, get_qty: null, min_total_cents: null, value_cents: 5000, sort: 2 },
  { name: "Segundo par al 50 %", description: "Al comprar unos espejuelos, el segundo par sale a mitad de precio. Se aplica en la venta del segundo par, con el número de la venta del primero.", kind: "bogo", pct: 50, buy_qty: 1, get_qty: 1, min_total_cents: null, value_cents: null, sort: 3 },
  { name: "Estuche y limpiador de regalo", description: "En compras desde $150, el paciente se lleva un estuche y un limpiador sin costo.", kind: "gift", pct: null, buy_qty: null, get_qty: null, min_total_cents: 15000, value_cents: 2500, sort: 4 },
  { name: "Temporada escolar: 15 % en toda la compra", description: "15 % de descuento en toda la compra durante la temporada escolar.", kind: "percent", pct: 15, buy_qty: null, get_qty: null, min_total_cents: null, value_cents: null, sort: 5 },
];
