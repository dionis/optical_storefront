/**
 * Catalog scraper runs: the monthly schedule, what the owner may set, and what a
 * worker's report is reduced to before the panel renders it. Pure functions —
 * the queue's atomicity is SQL (catalog-sync-data.ts) and is not mocked here.
 */
import {
  DEFAULT_SETTINGS,
  MAX_LOG_CHARS,
  MAX_VIEWS_COST,
  SCHEDULE_GRACE_MS,
  cleanErrorReason,
  cleanFinalStatus,
  cleanLogTail,
  cleanNewProducts,
  cleanSummary,
  isScheduleDue,
  isWorkerOnline,
  nextScheduledAt,
  scheduleSlot,
  validateRunOptions,
  validateSettings,
} from "../src/lib/catalog-sync";

const at = (iso: string) => new Date(iso);

describe("monthly schedule", () => {
  const s = { ...DEFAULT_SETTINGS, schedule_day: 1, schedule_hour: 6 };

  it("is not due before the instant", () => {
    expect(isScheduleDue(s, at("2026-11-01T05:59:00Z"))).toBe(false);
  });

  it("is due from the instant and through the grace window", () => {
    expect(isScheduleDue(s, at("2026-11-01T06:00:00Z"))).toBe(true);
    expect(isScheduleDue(s, at("2026-11-02T12:00:00Z"))).toBe(true);
  });

  it("is not due once the grace window has passed (enabling it mid-month does not fire)", () => {
    const after = new Date(at("2026-11-01T06:00:00Z").getTime() + SCHEDULE_GRACE_MS);
    expect(isScheduleDue(s, after)).toBe(false);
    expect(isScheduleDue(s, at("2026-11-20T06:00:00Z"))).toBe(false);
  });

  it("is never due when disabled", () => {
    expect(isScheduleDue({ ...s, schedule_enabled: false }, at("2026-11-01T06:00:00Z"))).toBe(false);
  });

  it("keys a month by its UTC year and month", () => {
    expect(scheduleSlot(at("2026-11-30T23:59:00Z"))).toBe("2026-11");
    expect(scheduleSlot(at("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });

  it("next run is this month when still ahead, otherwise next month", () => {
    expect(nextScheduledAt(s, at("2026-10-31T10:00:00Z"))?.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(nextScheduledAt(s, at("2026-11-01T07:00:00Z"))?.toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(nextScheduledAt(s, at("2026-12-15T00:00:00Z"))?.toISOString()).toBe("2027-01-01T06:00:00.000Z");
    expect(nextScheduledAt({ ...s, schedule_enabled: false }, at("2026-11-01T00:00:00Z"))).toBeNull();
  });
});

describe("settings validation", () => {
  it("merges a partial update", () => {
    const r = validateSettings(DEFAULT_SETTINGS, { schedule_day: 15 });
    expect(r).toEqual({ value: { ...DEFAULT_SETTINGS, schedule_day: 15 } });
  });

  it.each([
    [{ schedule_day: 29 }, "invalid_schedule_day"],
    [{ schedule_day: 0 }, "invalid_schedule_day"],
    [{ schedule_hour: 24 }, "invalid_schedule_hour"],
    [{ schedule_hour: 1.5 }, "invalid_schedule_hour"],
    [{ schedule_enabled: "yes" }, "invalid_schedule_enabled"],
    [{ views_max_cost: -1 }, "invalid_views_max_cost"],
    [{ views_max_cost: MAX_VIEWS_COST + 1 }, "invalid_views_max_cost"],
  ])("rejects %j (never clamps)", (body, reason) => {
    expect(validateSettings(DEFAULT_SETTINGS, body)).toEqual({ reason });
  });
});

describe("run options", () => {
  it("defaults to incremental, all collections, the owner's view budget", () => {
    expect(validateRunOptions({ ...DEFAULT_SETTINGS, views_max_cost: 7 }, {})).toEqual({
      value: { full: false, collection: null, views_max_cost: 7 },
    });
  });

  it("accepts a collection slug and 0 (queue views only)", () => {
    expect(validateRunOptions(DEFAULT_SETTINGS, { collection: " Di-Caprio ", views_max_cost: 0 })).toEqual({
      value: { full: false, collection: "di-caprio", views_max_cost: 0 },
    });
  });

  it("refuses a collection that is not a slug", () => {
    expect(validateRunOptions(DEFAULT_SETTINGS, { collection: "x; rm -rf /" })).toEqual({ reason: "invalid_collection" });
  });
});

describe("worker report", () => {
  it("keeps only known numeric summary fields", () => {
    const s = cleanSummary({ new: 3, found: 10.7, failed: -2, hacked: "<script>", views_cost_usd: 0.12345, views_note: "no_budget" });
    expect(s.new).toBe(3);
    expect(s.found).toBe(10);
    expect(s.failed).toBe(0);
    expect(s.views_cost_usd).toBe(0.1235);
    expect(s.views_note).toBe("no_budget");
    expect(s).not.toHaveProperty("hacked");
  });

  it("drops new-product entries without a handle", () => {
    expect(cleanNewProducts([{ handle: "a-4u", title: "A", colors: 2 }, { title: "no handle" }, null])).toEqual([
      { handle: "a-4u", title: "A", brand: null, thumbnail: null, colors: 2 },
    ]);
  });

  it("keeps the END of a long log", () => {
    const log = "x".repeat(MAX_LOG_CHARS) + "THE ERROR";
    expect(cleanLogTail(log)?.endsWith("THE ERROR")).toBe(true);
    expect(cleanLogTail(log)?.length).toBe(MAX_LOG_CHARS);
  });

  it("accepts only final statuses, and maps unknown error codes to crashed", () => {
    expect(cleanFinalStatus("running")).toBeNull();
    expect(cleanFinalStatus("partial")).toBe("partial");
    expect(cleanErrorReason("config_error")).toBe("config_error");
    expect(cleanErrorReason("Traceback (most recent call last)")).toBe("crashed");
    expect(cleanErrorReason(undefined)).toBeNull();
  });

  it("calls a worker offline after three missed polls", () => {
    const now = at("2026-11-02T12:00:00Z");
    expect(isWorkerOnline("2026-11-02T11:59:00Z", now)).toBe(true);
    expect(isWorkerOnline("2026-11-02T11:56:00Z", now)).toBe(false);
    expect(isWorkerOnline(null, now)).toBe(false);
  });
});
