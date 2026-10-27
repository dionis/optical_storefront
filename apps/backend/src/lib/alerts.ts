/**
 * Sales alerts (functional document E7, HU-40 to HU-45). Pure — no I/O; the
 * subscribers, routes and the hourly job call alerts-data.ts.
 *
 * Owner's decisions:
 *  - email only;
 *  - each rule carries its own list of addresses, set by whoever creates or
 *    edits it; no hidden recipients;
 *  - frequency per rule (owner or superadmin): immediate, a summary every 1–12
 *    hours, daily at a chosen time, or weekly;
 *  - start with: immediate on every sale, on discounts waiting for approval, on
 *    voids and on cash differences, and a daily summary at 20:00 Katy time.
 *
 * Alerts never carry prescription values or insurance member data.
 */

export const ALERT_EVENTS = [
  "sale.created",
  "discount.applied",
  "discount.requested",
  "sale.below_min",
  "sale.voided",
  "cash.diff",
  "store.idle",
  "digest",
] as const;
export type AlertEventName = (typeof ALERT_EVENTS)[number];
export const ALERT_MODES = ["immediate", "every_n_hours", "daily", "weekly"] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

/** "Discount waiting for approval" expects an answer: it is always immediate. */
export const IMMEDIATE_ONLY: ReadonlySet<string> = new Set(["discount.requested"]);
/** A digest and an idle store are summaries by nature: never immediate. */
export const SCHEDULED_ONLY: ReadonlySet<string> = new Set(["digest", "store.idle"]);

export interface AlertConditions {
  /** sale.created: only sales of at least this total ("venta grande"). */
  min_total?: number;
  /** discount.applied: only discounts of at least this percentage. */
  min_discount_pct?: number;
  /** store.idle: local "HH:MM" after which a store with no sale today warns. */
  idle_after?: string;
  /** Also web orders (the web keeps its own detailed order email to the admins). */
  include_web?: boolean;
}

export interface AlertSchedule {
  hours?: number;
  at?: string;
  weekday?: number;
}

export interface RuleLike {
  id: string;
  event: string;
  conditions: AlertConditions | null;
  establishment_ids: string[] | null;
  seller_ids: string[] | null;
  recipients: string[];
  mode: AlertMode;
  schedule: AlertSchedule | null;
  is_active: boolean;
  last_sent_at: string | Date | null;
}

export interface AlertEvent {
  event: AlertEventName;
  /** Unique per occurrence (sale id, approval id…): the same event never mails twice. */
  key: string;
  establishment_id: string | null;
  seller_id: string | null;
  /** From the online store (web order), not a till. */
  is_web?: boolean;
  /** Display data only: number, store, amounts, seller code, reason. */
  data: Record<string, string | number | null>;
}

/** Whether a rule wants this event. */
export function ruleMatches(rule: RuleLike, ev: AlertEvent): boolean {
  if (!rule.is_active || rule.event !== ev.event) return false;
  const c = rule.conditions ?? {};
  if (ev.is_web && !c.include_web) return false;
  if (!ev.is_web && rule.establishment_ids?.length && (!ev.establishment_id || !rule.establishment_ids.includes(ev.establishment_id))) return false;
  if (rule.seller_ids?.length && (!ev.seller_id || !rule.seller_ids.includes(ev.seller_id))) return false;
  if (ev.event === "sale.created" && c.min_total != null && Number(ev.data.total ?? 0) < c.min_total) return false;
  if (ev.event === "discount.applied" && c.min_discount_pct != null && Number(ev.data.discount_pct ?? 0) < c.min_discount_pct) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Rule validation
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface CleanRule {
  name: string;
  event: AlertEventName;
  conditions: AlertConditions;
  establishment_ids: string[] | null;
  seller_ids: string[] | null;
  recipients: string[];
  mode: AlertMode;
  schedule: AlertSchedule | null;
  locale: "es" | "en";
  is_active: boolean;
}

/**
 * Validates a rule as written by its author. `canSchedule` false (a
 * supervisor) keeps the frequency at the event's default; `allowedStores`
 * limits the stores a supervisor may watch (null = any).
 */
export function cleanRule(
  body: Record<string, unknown> | null | undefined,
  opts: { canSchedule: boolean; allowedStores: string[] | null; knownStores: string[] }
): { reason: string } | { rule: CleanRule } {
  const b = body ?? {};
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
  if (!name) return { reason: "name_required" };
  const event = String(b.event ?? "");
  if (!(ALERT_EVENTS as readonly string[]).includes(event)) return { reason: "bad_event" };

  const raw = Array.isArray(b.recipients) ? b.recipients : String(b.recipients ?? "").split(/[,;\s]+/);
  const recipients = [...new Set(raw.map((r) => String(r).trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return { reason: "recipients_required" };
  if (recipients.length > 20 || recipients.some((r) => !EMAIL.test(r))) return { reason: "bad_recipient" };

  let establishment_ids: string[] | null = null;
  if (Array.isArray(b.establishment_ids) && b.establishment_ids.length) {
    establishment_ids = [...new Set(b.establishment_ids.map(String))];
    if (establishment_ids.some((id) => !opts.knownStores.includes(id))) return { reason: "bad_store" };
  }
  if (opts.allowedStores) {
    // A supervisor's rule watches their stores only, and must say which.
    if (!establishment_ids) establishment_ids = [...opts.allowedStores];
    if (establishment_ids.some((id) => !opts.allowedStores!.includes(id))) return { reason: "forbidden_store" };
  }
  const seller_ids = Array.isArray(b.seller_ids) && b.seller_ids.length ? [...new Set(b.seller_ids.map(String))].slice(0, 50) : null;

  const c = (b.conditions && typeof b.conditions === "object" ? b.conditions : {}) as Record<string, unknown>;
  const conditions: AlertConditions = {};
  if (c.min_total !== undefined && c.min_total !== null && c.min_total !== "") {
    const n = Number(c.min_total);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { reason: "bad_condition" };
    conditions.min_total = n;
  }
  if (c.min_discount_pct !== undefined && c.min_discount_pct !== null && c.min_discount_pct !== "") {
    const n = Number(c.min_discount_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { reason: "bad_condition" };
    conditions.min_discount_pct = n;
  }
  if (event === "store.idle") {
    const at = String(c.idle_after ?? "14:00");
    if (!HHMM.test(at)) return { reason: "bad_condition" };
    conditions.idle_after = at;
  }
  if (c.include_web === true) conditions.include_web = true;

  let mode: AlertMode = SCHEDULED_ONLY.has(event) ? (event === "digest" ? "daily" : "every_n_hours") : "immediate";
  let schedule: AlertSchedule | null = event === "digest" ? { at: "20:00" } : event === "store.idle" ? { hours: 1 } : null;
  if (opts.canSchedule && b.mode !== undefined) {
    const m = String(b.mode);
    if (!(ALERT_MODES as readonly string[]).includes(m)) return { reason: "bad_mode" };
    mode = m as AlertMode;
    const s = (b.schedule && typeof b.schedule === "object" ? b.schedule : {}) as Record<string, unknown>;
    if (mode === "every_n_hours") {
      const h = Number(s.hours);
      if (!Number.isInteger(h) || h < 1 || h > 12) return { reason: "bad_schedule" };
      schedule = { hours: h };
    } else if (mode === "daily") {
      const at = String(s.at ?? "");
      if (!HHMM.test(at)) return { reason: "bad_schedule" };
      schedule = { at };
    } else if (mode === "weekly") {
      const at = String(s.at ?? "");
      const wd = Number(s.weekday);
      if (!HHMM.test(at) || !Number.isInteger(wd) || wd < 0 || wd > 6) return { reason: "bad_schedule" };
      schedule = { weekday: wd, at };
    } else schedule = null;
  }
  if (IMMEDIATE_ONLY.has(event)) { mode = "immediate"; schedule = null; }
  if (SCHEDULED_ONLY.has(event) && mode === "immediate") return { reason: "bad_mode" };

  return {
    rule: {
      name,
      event: event as AlertEventName,
      conditions,
      establishment_ids,
      seller_ids,
      recipients,
      mode,
      schedule,
      locale: b.locale === "en" ? "en" : "es",
      is_active: b.is_active === false ? false : true,
    },
  };
}

// ---------------------------------------------------------------------------
// Schedules, in the store's local time
// ---------------------------------------------------------------------------

export interface LocalParts {
  date: string;
  hour: number;
  minute: number;
  weekday: number;
}

/** Calendar date, time and weekday of `d` in `tz` (America/Chicago for the stores). */
export function localParts(d: Date, tz: string): LocalParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: weekdays.indexOf(p.weekday),
  };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether a batched rule's summary is due now. */
export function summaryDue(rule: Pick<RuleLike, "mode" | "schedule" | "last_sent_at">, now: Date, tz: string): boolean {
  if (rule.mode === "immediate") return false;
  const last = rule.last_sent_at ? new Date(rule.last_sent_at) : null;
  if (rule.mode === "every_n_hours") {
    const hours = rule.schedule?.hours ?? 1;
    return !last || now.getTime() - last.getTime() >= hours * 3600_000 - 60_000;
  }
  const at = rule.schedule?.at ?? "20:00";
  const here = localParts(now, tz);
  if (here.hour * 60 + here.minute < minutesOf(at)) return false;
  if (rule.mode === "weekly" && here.weekday !== (rule.schedule?.weekday ?? 1)) return false;
  return !last || localParts(last, tz).date !== here.date;
}

/** A store with no sale today, past the rule's time, warns once a day. */
export function storeIdle(args: { now: Date; tz: string; idleAfter: string; lastSaleAt: Date | null }): boolean {
  const here = localParts(args.now, args.tz);
  if (here.hour * 60 + here.minute < minutesOf(args.idleAfter)) return false;
  return !args.lastSaleAt || localParts(args.lastSaleAt, args.tz).date !== here.date;
}

/** The rules the system starts with (owner's decision), mailed to today's admin recipients. */
export function defaultRules(recipients: string[], locale: "es" | "en"): CleanRule[] {
  const base = { conditions: {}, establishment_ids: null, seller_ids: null, recipients, locale, is_active: true };
  return [
    { ...base, name: locale === "en" ? "Every sale" : "Cada venta", event: "sale.created", mode: "immediate", schedule: null },
    { ...base, name: locale === "en" ? "Discount to approve" : "Descuento por aprobar", event: "discount.requested", mode: "immediate", schedule: null },
    { ...base, name: locale === "en" ? "Void" : "Anulación", event: "sale.voided", mode: "immediate", schedule: null },
    { ...base, name: locale === "en" ? "Cash difference" : "Diferencia de caja", event: "cash.diff", mode: "immediate", schedule: null },
    { ...base, name: locale === "en" ? "Daily summary" : "Resumen diario", event: "digest", mode: "daily", schedule: { at: "20:00" } },
  ];
}
