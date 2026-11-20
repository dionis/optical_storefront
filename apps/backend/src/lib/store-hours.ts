/**
 * OPENING HOURS OF EACH STORE (owner, 15-nov-2026: «se debe poder editar el
 * horario de apertura y cierre de cada tienda y manejarlo en el panel de
 * admin»). Kept on the store (`establishment.hours`, migration
 * CreateEstablishmentHours7), edited in Tiendas → Editar → Horario.
 *
 *   {
 *     week: { mon: { open: "09:00", close: "18:00" } | { closed: true }, …, sun },
 *     special: [{ date: "2026-12-24", open: "09:00", close: "13:00", label: "Nochebuena" },
 *               { date: "2026-12-25", closed: true, label: "Navidad" }]
 *   }
 *
 * Times are the store's local wall clock in the tenant's time zone. A special
 * day replaces the weekday it falls on. Where it is used: the store directory
 * («Abierta ahora · cierra 18:00»), the receipts (one line with the week), and
 * the till, which warns — never blocks — when a sale is rung up outside hours.
 *
 * Pure: exported for the tests.
 */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type DayHours = { closed: true } | { closed?: false; open: string; close: string };
export interface SpecialDay {
  date: string;
  label: string | null;
  closed: boolean;
  open: string | null;
  close: string | null;
}
export interface StoreHours {
  week: Record<Weekday, DayHours>;
  special: SpecialDay[];
}
export const MAX_SPECIAL_DAYS = 60;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function cleanDay(raw: unknown): DayHours | { reason: string } {
  const d = (raw ?? {}) as { closed?: unknown; open?: unknown; close?: unknown };
  if (d.closed === true) return { closed: true };
  const open = String(d.open ?? "").trim();
  const close = String(d.close ?? "").trim();
  if (!HHMM.test(open) || !HHMM.test(close)) return { reason: "bad_hours" };
  // Closing after midnight is not a store's hours: refuse instead of guessing.
  if (minutes(close) <= minutes(open)) return { reason: "close_before_open" };
  return { open, close };
}

/** The hours as sent by the panel, checked. `null` clears them. */
export function cleanStoreHours(raw: unknown): { hours: StoreHours | null } | { reason: string; day?: string } {
  if (raw === null) return { hours: null };
  if (!raw || typeof raw !== "object") return { reason: "bad_hours" };
  const r = raw as { week?: Record<string, unknown>; special?: unknown };
  const week = {} as Record<Weekday, DayHours>;
  for (const d of WEEKDAYS) {
    const c = cleanDay(r.week?.[d]);
    if ("reason" in c) return { reason: c.reason, day: d };
    week[d] = c;
  }
  const special: SpecialDay[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(r.special) ? r.special : [];
  if (list.length > MAX_SPECIAL_DAYS) return { reason: "too_many_special_days" };
  for (const s of list as Array<Record<string, unknown>>) {
    const date = String(s?.date ?? "").trim();
    // The round trip catches 30 February (Date would roll it into March).
    if (!YMD.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return { reason: "bad_special_date", day: date };
    if (seen.has(date)) return { reason: "duplicate_special_date", day: date };
    seen.add(date);
    const label = typeof s.label === "string" && s.label.trim() ? s.label.trim().slice(0, 60) : null;
    const c = cleanDay(s);
    if ("reason" in c) return { reason: c.reason, day: date };
    special.push({ date, label, closed: c.closed === true, open: c.closed ? null : c.open, close: c.closed ? null : c.close });
  }
  special.sort((a, b) => a.date.localeCompare(b.date));
  return { hours: { week, special } };
}

/** The wall clock of `at` in `timeZone`: date, weekday and minutes since midnight. Pure. */
export function localClock(at: Date, timeZone: string): { ymd: string; weekday: Weekday; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const weekday = String(parts.weekday).slice(0, 3).toLowerCase() as Weekday;
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (ymd: string): Weekday => WEEKDAYS[(new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7];

/** What a given date looks like: a special day if there is one, else its weekday. Pure. */
export function dayOf(hours: StoreHours, ymd: string): { closed: boolean; open: string | null; close: string | null; special: SpecialDay | null } {
  const sp = hours.special.find((s) => s.date === ymd) ?? null;
  if (sp) return { closed: sp.closed, open: sp.open, close: sp.close, special: sp };
  const d = hours.week[weekdayOf(ymd)];
  return d.closed ? { closed: true, open: null, close: null, special: null } : { closed: false, open: d.open, close: d.close, special: null };
}

export interface HoursStatus {
  /** No hours set: nothing is said. */
  known: boolean;
  open: boolean;
  /** Today's closing time while open. */
  closes_at: string | null;
  /** The next opening: date (YYYY-MM-DD), time and whether it is today. */
  next_open: { date: string; time: string; today: boolean } | null;
  /** Today's special day, if any (holiday, short day). */
  special: SpecialDay | null;
}

/** Whether the store is open at `at`, and when it closes or opens next. Pure. */
export function hoursStatus(hours: StoreHours | null | undefined, at: Date, timeZone: string): HoursStatus {
  if (!hours) return { known: false, open: false, closes_at: null, next_open: null, special: null };
  const now = localClock(at, timeZone);
  const today = dayOf(hours, now.ymd);
  if (!today.closed && today.open && today.close && now.minutes >= minutes(today.open) && now.minutes < minutes(today.close)) {
    return { known: true, open: true, closes_at: today.close, next_open: null, special: today.special };
  }
  let next: HoursStatus["next_open"] = null;
  if (!today.closed && today.open && now.minutes < minutes(today.open)) next = { date: now.ymd, time: today.open, today: true };
  for (let i = 1; !next && i <= 14; i++) {
    const ymd = addDays(now.ymd, i);
    const d = dayOf(hours, ymd);
    if (!d.closed && d.open) next = { date: ymd, time: d.open, today: false };
  }
  return { known: true, open: false, closes_at: null, next_open: next, special: today.special };
}

/**
 * The week in one line for receipts: consecutive days with the same hours are
 * grouped («L–V 09:00–18:00 · S 10:00–14:00 · D cerrado»). `names` are the
 * short day names in the reader's language, Monday first. Pure.
 */
export function weekLine(hours: StoreHours | null | undefined, names: readonly string[], closedWord: string): string {
  if (!hours) return "";
  const key = (d: DayHours) => (d.closed ? "closed" : `${d.open}–${d.close}`);
  const groups: Array<{ from: number; to: number; k: string }> = [];
  WEEKDAYS.forEach((d, i) => {
    const k = key(hours.week[d]);
    const last = groups[groups.length - 1];
    if (last && last.k === k && last.to === i - 1) last.to = i;
    else groups.push({ from: i, to: i, k });
  });
  return groups
    .map((g) => `${g.from === g.to ? names[g.from] : `${names[g.from]}–${names[g.to]}`} ${g.k === "closed" ? closedWord : g.k}`)
    .join(" · ");
}

/** Hours a new store starts with in the editor (nothing is saved until the owner saves). */
export const DEFAULT_HOURS: StoreHours = {
  week: {
    mon: { open: "09:00", close: "18:00" },
    tue: { open: "09:00", close: "18:00" },
    wed: { open: "09:00", close: "18:00" },
    thu: { open: "09:00", close: "18:00" },
    fri: { open: "09:00", close: "18:00" },
    sat: { open: "10:00", close: "14:00" },
    sun: { closed: true },
  },
  special: [],
};
