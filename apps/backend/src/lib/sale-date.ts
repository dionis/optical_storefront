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
 * What does NOT move:
 *  - the money: the payments taken now are of NOW and go into today's open cash
 *    register (a closed register never changes, lib/cash.ts);
 *  - the prices, the discount limits and the promotions: today's (the quote is
 *    today's quote);
 *  - the sale number and the prescription number: the next ones of the sequence.
 *
 * How far back, by role: the seller a week, a manager or a supervisor a month,
 * the owner and the superadmins a year. Never a future day.
 */
import { localParts } from "./alerts";
import type { StaffRole } from "./staff-roles";

export const BACKDATE_MAX_DAYS: Record<StaffRole, number> = { owner: 366, superadmin: 366, supervisor: 31, manager: 31, seller: 7 };
/** A person without a role (the creator of an old sale) counts as a seller. */
export const maxBackdateDays = (role: StaffRole | null | undefined): number => (role ? BACKDATE_MAX_DAYS[role] : BACKDATE_MAX_DAYS.seller);

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
}

export type BackdateReason = "sold_on_invalid" | "sold_on_future" | "sold_on_too_old";

/**
 * The till's `sold_on` ({ date, time?, note? }): null = today (no backdate),
 * the backdate, or why not. `role` decides how far back.
 */
export function cleanSoldOn(input: unknown, now: Date, timeZone: string, role: StaffRole | null | undefined): Backdate | null | { reason: BackdateReason; max?: number } {
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
  const max = maxBackdateDays(role);
  if (days > max) return { reason: "sold_on_too_old", max };
  const time = rawTime || DEFAULT_BACKDATE_TIME;
  return { soldAt: zonedInstant(date, time, timeZone), date, time, note: noteRaw || null, days };
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
}

export const backdateRecord = (b: Backdate, recordedAt: Date, by: string | null): BackdateRecord => ({
  recorded_at: recordedAt.toISOString(),
  by,
  date: b.date,
  time: b.time,
  note: b.note,
});
