/**
 * A SALE WITH AN EARLIER DATE (owner, 18-nov-2026: «cuando se registre una
 * venta se debe poder poner fecha retroactiva»). Pure.
 *
 * The till records today by default. The person can say the sale happened on
 * an earlier day of the store's calendar (a sale written on paper while the
 * system was down, one registered the next morning): the sale then IS of that
 * day for everything that reads its date — its row (`pos_sale.created_at`), the
 * Medusa order, the dashboards (`sale_fact.sold_date_local`), the statement,
 * the result and the receipt — and remembers when it was really recorded and
 * by whom (`pos_sale.backdate`, migration CreatePos11, and the audit log).
 *
 * The money (owner, 19-nov-2026: «con toda la actualización necesaria de tal
 * forma que se vaya cuadrando la contabilidad»): the person says when it was
 * collected —
 *  - `money_on: "sale"` (default): it was collected THAT day and is already
 *    counted or banked: the payments carry the sale's instant (fees, statement
 *    and month follow it) and do NOT enter any register (a closed register never
 *    changes, and today's would show cash that is not in the drawer);
 *  - `money_on: "today"`: it is collected now: the payments are of now and the
 *    cash goes into today's open register, as any sale.
 * `delivered: true` = the patient already has the glasses (an old sale written
 * in to build the history): no tray is taken, the sale is delivered as of that
 * day, and the patient gets no message. Only a sale paid in full.
 * A sale with lenses and no prescription date takes the sale's day as its date.
 *
 * What does NOT move: the prices, the discount limits and the promotions
 * (today's quote), and the sale and prescription numbers (the next ones).
 *
 * How far back: one year for every role by default; the owner can narrow it
 * per role in Configuración del POS (`pos_setting.backdate_limits`, migration
 * CreatePos2BackdateLimits). Never a future day.
 */
import { localParts } from "./alerts";
import type { StaffRole } from "./staff-roles";

/** The furthest back anyone can go (a year, leap day included). */
export const BACKDATE_CEILING = 366;
export const BACKDATE_MAX_DAYS: Record<StaffRole, number> = { owner: 366, superadmin: 366, supervisor: 366, manager: 366, seller: 366 };
export type BackdateLimits = { seller: number; manager: number; supervisor: number };
export const DEFAULT_BACKDATE_LIMITS: BackdateLimits = { seller: 366, manager: 366, supervisor: 366 };
/**
 * How many days back a role may date a sale: the owner's limit for sellers,
 * managers and supervisors (default a year); owner and superadmins always a
 * year. A person without a role (the creator of an old sale) counts as a seller.
 */
export const maxBackdateDays = (role: StaffRole | null | undefined, limits: BackdateLimits = DEFAULT_BACKDATE_LIMITS): number =>
  role === "owner" || role === "superadmin" ? BACKDATE_CEILING : Math.min(BACKDATE_CEILING, limits[(role ?? "seller") as keyof BackdateLimits] ?? DEFAULT_BACKDATE_LIMITS.seller);

/** The owner's limits as stored → clean (0–366 days each; missing or bad = the default). */
export function normalizeBackdateLimits(raw: unknown): BackdateLimits {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof BackdateLimits) => {
    const n = Number(r[k]);
    return Number.isInteger(n) && n >= 0 && n <= BACKDATE_CEILING ? n : DEFAULT_BACKDATE_LIMITS[k];
  };
  return { seller: pick("seller"), manager: pick("manager"), supervisor: pick("supervisor") };
}

export function backdateLimitsDenied(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "bad_backdate_limits";
  for (const k of ["seller", "manager", "supervisor"] as const) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > BACKDATE_CEILING) return "bad_backdate_limits";
  }
  return null;
}

/** The hour a backdated sale gets when the person gives none (the dashboards bucket by hour). */
export const DEFAULT_BACKDATE_TIME = "12:00";
export const BACKDATE_NOTE_MAX = 200;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Whole days from `from` to `to` (YYYY-MM-DD, calendar days). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/** A real calendar day (2026-02-30 is not one). */
function realDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * The instant of a wall-clock date and time in `timeZone` (daylight saving
 * included): guess it as UTC, see what the zone's clock says then, and correct
 * by the difference (twice, for the day the clock changes).
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  let at = wanted;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(at), timeZone);
    const shown = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), p.hour, p.minute);
    at += wanted - shown;
  }
  return new Date(at);
}

export interface Backdate {
  /** The instant the sale is recorded as (store's date at `time`). */
  soldAt: Date;
  date: string;
  time: string;
  note: string | null;
  days: number;
  /** When the money was collected: that day (off the registers) or now (today's register). */
  moneyOn: "sale" | "today";
  /** The patient already has the glasses: delivered as of that day, no tray, no message. */
  delivered: boolean;
}

export type BackdateReason = "sold_on_invalid" | "sold_on_future" | "sold_on_too_old";

/**
 * The till's `sold_on` ({ date, time?, note? }): null = today (no backdate),
 * the backdate, or why not. `role` decides how far back.
 */
export function cleanSoldOn(input: unknown, now: Date, timeZone: string, role: StaffRole | null | undefined, limits: BackdateLimits = DEFAULT_BACKDATE_LIMITS): Backdate | null | { reason: BackdateReason; max?: number } {
  if (input == null || input === "") return null;
  if (typeof input !== "object") return { reason: "sold_on_invalid" };
  const o = input as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date.trim() : "";
  if (!date) return null;
  if (!realDate(date)) return { reason: "sold_on_invalid" };
  const rawTime = typeof o.time === "string" ? o.time.trim() : "";
  if (rawTime && !TIME_RE.test(rawTime)) return { reason: "sold_on_invalid" };
  const noteRaw = typeof o.note === "string" ? o.note.trim() : "";
  if (noteRaw.length > BACKDATE_NOTE_MAX) return { reason: "sold_on_invalid" };
  const today = localParts(now, timeZone).date;
  const days = daysBetween(date, today);
  if (days < 0) return { reason: "sold_on_future" };
  if (days === 0) return null; // today is the default, not a backdate
  const max = maxBackdateDays(role, limits);
  if (days > max) return { reason: "sold_on_too_old", max };
  const time = rawTime || DEFAULT_BACKDATE_TIME;
  if (o.money_on !== undefined && o.money_on !== null && o.money_on !== "sale" && o.money_on !== "today") return { reason: "sold_on_invalid" };
  return { soldAt: zonedInstant(date, time, timeZone), date, time, note: noteRaw || null, days, moneyOn: o.money_on === "today" ? "today" : "sale", delivered: o.delivered === true };
}

/** What the sale row keeps about it (`pos_sale.backdate`). */
export interface BackdateRecord {
  /** When the sale was really recorded (ISO). */
  recorded_at: string;
  /** Who recorded it (user id). */
  by: string | null;
  /** The day and time it was recorded AS (store's calendar). */
  date: string;
  time: string;
  note: string | null;
  /** When the money was collected (see the head of this file); absent on sales recorded before 19-nov-2026 = "today". */
  money_on?: "sale" | "today";
  /** Recorded as already delivered. */
  delivered?: boolean;
}

export const backdateRecord = (b: Backdate, recordedAt: Date, by: string | null): BackdateRecord => ({
  recorded_at: recordedAt.toISOString(),
  by,
  date: b.date,
  time: b.time,
  note: b.note,
  money_on: b.moneyOn,
  delivered: b.delivered,
});
