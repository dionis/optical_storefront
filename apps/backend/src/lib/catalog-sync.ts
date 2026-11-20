/**
 * Catalog scraper runs — the rules, as pure functions (no database, no HTTP).
 *
 * The scraper runs in its own Coolify app (`python -m scraper worker`) and polls
 * Medusa for work. Medusa decides WHEN: a run is queued by the owner's button or
 * by the monthly schedule (`src/jobs/catalog-sync-schedule.ts`). This file says
 * when the schedule is due, what a valid setting or run request is, and how much
 * of a worker's report is kept. The queue itself is `catalog-sync-data.ts`.
 */
import { absoluteImageUrl } from "./image-url";

export const SETTINGS_ID = "default";

export interface CatalogSyncSettings {
  schedule_enabled: boolean;
  /** 1–28 so that every month has the day. */
  schedule_day: number;
  /** 0–23, UTC. */
  schedule_hour: number;
  /** Scheduled runs re-process every product and draft discontinued ones. */
  schedule_full: boolean;
  /** USD cap for the 4 views of each run's NEW models; 0 = queue only. */
  views_max_cost: number;
}

export const DEFAULT_SETTINGS: CatalogSyncSettings = {
  schedule_enabled: true,
  schedule_day: 1,
  schedule_hour: 6,
  schedule_full: false,
  views_max_cost: 10,
};

/**
 * Upper bound for one run's view budget. The whole catalogue is ~$223 of views
 * (docs/frame-media-generation.md §2), and a monthly run only touches new
 * models, so anything above this is a typo, not a decision.
 */
export const MAX_VIEWS_COST = 100;

/**
 * A running run whose worker has not reported for this long is declared lost.
 * The worker reports at least once per product (~15–75 s) and per generated view
 * (~10–30 s); 20 minutes absorbs a slow supplier page without leaving a dead run
 * on screen for hours.
 */
export const STALE_AFTER_MS = 20 * 60 * 1000;

/** The worker polls every minute; three missed polls and the panel says it is offline. */
export const WORKER_ONLINE_MS = 3 * 60 * 1000;

/**
 * How long after its scheduled instant a month's run may still be queued. Covers
 * a backend that was redeploying at 06:00, without turning "I just enabled the
 * schedule on the 20th" into a surprise full scrape.
 */
export const SCHEDULE_GRACE_MS = 48 * 60 * 60 * 1000;

export const ACTIVE_STATUSES = ["queued", "running"] as const;
export const FINAL_STATUSES = ["succeeded", "partial", "failed", "canceled"] as const;
export type FinalStatus = (typeof FINAL_STATUSES)[number];

/** Codes the worker may send in `error_reason`; anything else becomes `crashed`. */
export const ERROR_REASONS = [
  "worker_lost",
  "config_error",
  "backend_unreachable",
  "supplier_unreachable",
  "aborted_failures",
  "crashed",
  // Set by the server, never by a worker: the month's run found a manual one active.
  "superseded",
] as const;

export interface RunOptions {
  full: boolean;
  collection: string | null;
  views_max_cost: number;
}

/** What one run did — the numbers the owner reads. Every field is a count or USD. */
export interface RunSummary {
  collections: number;
  found: number;
  new: number;
  updated: number;
  unchanged: number;
  failed: number;
  drafted: number;
  views_queued: number;
  views_generated: number;
  views_failed: number;
  views_cost_usd: number;
  /** Why view generation did not run or stopped (`no_budget`, `not_configured`, `ceiling`…). */
  views_note: string | null;
}

export const SUMMARY_COUNTS = [
  "collections",
  "found",
  "new",
  "updated",
  "unchanged",
  "failed",
  "drafted",
  "views_queued",
  "views_generated",
  "views_failed",
] as const;

const COLLECTION_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

const isCost = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_VIEWS_COST;

/**
 * Validates a settings update. Partial on purpose: the panel sends the field
 * that changed. Returns the merged settings, or the `reason` of the first field
 * that is wrong — out of range is rejected, never clamped.
 */
export function validateSettings(
  current: CatalogSyncSettings,
  body: Record<string, unknown>
): { value: CatalogSyncSettings } | { reason: string } {
  const next = { ...current };
  if (body.schedule_enabled !== undefined) {
    if (typeof body.schedule_enabled !== "boolean") return { reason: "invalid_schedule_enabled" };
    next.schedule_enabled = body.schedule_enabled;
  }
  if (body.schedule_day !== undefined) {
    if (!isInt(body.schedule_day, 1, 28)) return { reason: "invalid_schedule_day" };
    next.schedule_day = body.schedule_day;
  }
  if (body.schedule_hour !== undefined) {
    if (!isInt(body.schedule_hour, 0, 23)) return { reason: "invalid_schedule_hour" };
    next.schedule_hour = body.schedule_hour;
  }
  if (body.schedule_full !== undefined) {
    if (typeof body.schedule_full !== "boolean") return { reason: "invalid_schedule_full" };
    next.schedule_full = body.schedule_full;
  }
  if (body.views_max_cost !== undefined) {
    if (!isCost(body.views_max_cost)) return { reason: "invalid_views_max_cost" };
    next.views_max_cost = Math.round(body.views_max_cost * 100) / 100;
  }
  return { value: next };
}

/** Validates a "run now" request; missing fields come from the owner's settings. */
export function validateRunOptions(
  settings: CatalogSyncSettings,
  body: Record<string, unknown>
): { value: RunOptions } | { reason: string } {
  const full = body.full === undefined ? false : body.full;
  if (typeof full !== "boolean") return { reason: "invalid_full" };

  let collection: string | null = null;
  if (body.collection !== undefined && body.collection !== null && body.collection !== "") {
    if (typeof body.collection !== "string" || !COLLECTION_RE.test(body.collection.trim().toLowerCase())) {
      return { reason: "invalid_collection" };
    }
    collection = body.collection.trim().toLowerCase();
  }

  const cost = body.views_max_cost === undefined ? settings.views_max_cost : body.views_max_cost;
  if (!isCost(cost)) return { reason: "invalid_views_max_cost" };

  return { value: { full, collection, views_max_cost: Math.round(cost * 100) / 100 } };
}

/** Options of the monthly run, from the owner's settings. */
export function scheduledRunOptions(settings: CatalogSyncSettings): RunOptions {
  return { full: settings.schedule_full, collection: null, views_max_cost: settings.views_max_cost };
}

/** "2026-11" — the unique key of a month's scheduled run, in UTC. */
export function scheduleSlot(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function instantInMonth(year: number, month: number, settings: CatalogSyncSettings): Date {
  return new Date(Date.UTC(year, month, settings.schedule_day, settings.schedule_hour, 0, 0, 0));
}

/**
 * True when this month's run should be queued now: the schedule is on, its
 * instant has passed and it passed less than SCHEDULE_GRACE_MS ago. Whether it
 * was ALREADY queued is not this function's question — the unique index on
 * `schedule_slot` answers that, atomically.
 */
export function isScheduleDue(settings: CatalogSyncSettings, now: Date): boolean {
  if (!settings.schedule_enabled) return false;
  const at = instantInMonth(now.getUTCFullYear(), now.getUTCMonth(), settings);
  const elapsed = now.getTime() - at.getTime();
  return elapsed >= 0 && elapsed < SCHEDULE_GRACE_MS;
}

/**
 * The next scheduled instant strictly after `now`, or null when the schedule is
 * off. `takenSlot` is the latest month that already has its run: if this month's
 * instant is still ahead but the month was already run (impossible today, but
 * cheap to be right about), the answer moves to next month.
 */
export function nextScheduledAt(
  settings: CatalogSyncSettings,
  now: Date,
  takenSlot: string | null = null
): Date | null {
  if (!settings.schedule_enabled) return null;
  const thisMonth = instantInMonth(now.getUTCFullYear(), now.getUTCMonth(), settings);
  if (thisMonth.getTime() > now.getTime() && takenSlot !== scheduleSlot(now)) return thisMonth;
  return instantInMonth(now.getUTCFullYear(), now.getUTCMonth() + 1, settings);
}

export function isWorkerOnline(seenAt: Date | string | null | undefined, now: Date): boolean {
  if (!seenAt) return false;
  return now.getTime() - new Date(seenAt).getTime() < WORKER_ONLINE_MS;
}

// ── What a worker may write ─────────────────────────────────────────────────

export const MAX_NEW_PRODUCTS = 500;
export const MAX_ERRORS = 200;
export const MAX_LOG_CHARS = 20_000;
const MAX_TEXT = 300;

const text = (v: unknown, max = MAX_TEXT): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/** Keeps the summary to known numeric fields; a worker cannot store arbitrary JSON here. */
export function cleanSummary(raw: unknown): RunSummary {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = Object.fromEntries(SUMMARY_COUNTS.map((k) => [k, count(src[k])])) as unknown as RunSummary;
  const cost = Number(src.views_cost_usd);
  out.views_cost_usd = Number.isFinite(cost) && cost > 0 ? Math.round(cost * 10_000) / 10_000 : 0;
  out.views_note = text(src.views_note, 60);
  return out;
}

export interface NewProduct {
  handle: string;
  title: string | null;
  brand: string | null;
  thumbnail: string | null;
  colors: number;
}

export function cleanNewProducts(raw: unknown): NewProduct[] {
  if (!Array.isArray(raw)) return [];
  const out: NewProduct[] = [];
  for (const item of raw.slice(0, MAX_NEW_PRODUCTS)) {
    const p = (item ?? {}) as Record<string, unknown>;
    const handle = text(p.handle, 120);
    if (!handle) continue;
    out.push({
      handle,
      title: text(p.title, 160),
      brand: text(p.brand, 80),
      thumbnail: absoluteImageUrl(text(p.thumbnail, 400)),
      colors: count(p.colors),
    });
  }
  return out;
}

export function cleanErrors(raw: unknown): { handle: string | null; message: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { handle: string | null; message: string }[] = [];
  for (const item of raw.slice(0, MAX_ERRORS)) {
    const e = (item ?? {}) as Record<string, unknown>;
    const message = text(e.message, 500);
    if (message) out.push({ handle: text(e.handle, 120), message });
  }
  return out;
}

/** The END of the log is what explains a failure, so that is the part kept. */
export function cleanLogTail(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return raw.length > MAX_LOG_CHARS ? raw.slice(-MAX_LOG_CHARS) : raw;
}

export function cleanFinalStatus(raw: unknown): FinalStatus | null {
  return (FINAL_STATUSES as readonly string[]).includes(raw as string) ? (raw as FinalStatus) : null;
}

export function cleanErrorReason(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  return (ERROR_REASONS as readonly string[]).includes(raw as string) ? (raw as string) : "crashed";
}

export function cleanProgress(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  return {
    phase: text(p.phase, 20),
    collection: text(p.collection, 60),
    position: count(p.position),
    total: count(p.total),
    collections_done: count(p.collections_done),
    collections_total: count(p.collections_total),
    handle: text(p.handle, 120),
  };
}
