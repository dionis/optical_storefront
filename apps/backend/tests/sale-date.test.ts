import { backdateLimitsDenied, backdateRecord, BACKDATE_CEILING, cleanSoldOn, daysBetween, maxBackdateDays, normalizeBackdateLimits, zonedInstant } from "../src/lib/sale-date";
import { localParts } from "../src/lib/alerts";

/**
 * A sale with an earlier date (owner, 18-nov-2026): never a future day, how far
 * back by role, the store's wall clock (daylight saving included), today = no
 * backdate.
 */
const TZ = "America/Chicago";
const NOW = new Date("2026-11-18T16:00:00Z"); // 10:00 in Texas, 18-nov

describe("sale date", () => {
  it("today (or nothing) is not a backdate", () => {
    expect(cleanSoldOn(null, NOW, TZ, "seller")).toBeNull();
    expect(cleanSoldOn({ date: "" }, NOW, TZ, "seller")).toBeNull();
    expect(cleanSoldOn({ date: "2026-11-18" }, NOW, TZ, "seller")).toBeNull();
  });

  it("a past day of the store's calendar, at the time given or noon", () => {
    const b = cleanSoldOn({ date: "2026-11-15", time: "17:30", note: " sistema caído " }, NOW, TZ, "seller");
    expect(b && !("reason" in b) && b).toMatchObject({ date: "2026-11-15", time: "17:30", note: "sistema caído", days: 3 });
    if (!b || "reason" in b) throw new Error("expected a backdate");
    expect(localParts(b.soldAt, TZ)).toMatchObject({ date: "2026-11-15", hour: 17, minute: 30 });
    const noon = cleanSoldOn({ date: "2026-11-17" }, NOW, TZ, "seller");
    if (!noon || "reason" in noon) throw new Error("expected a backdate");
    expect(noon.time).toBe("12:00");
    expect(localParts(noon.soldAt, TZ).hour).toBe(12);
  });

  it("never the future; a year back for every role by default", () => {
    expect(cleanSoldOn({ date: "2026-11-19" }, NOW, TZ, "owner")).toEqual({ reason: "sold_on_future" });
    for (const role of ["seller", "manager", "supervisor", "owner", "superadmin"] as const) {
      expect(cleanSoldOn({ date: "2025-11-18" }, NOW, TZ, role)).not.toHaveProperty("reason");
      expect(cleanSoldOn({ date: "2025-11-16" }, NOW, TZ, role)).toEqual({ reason: "sold_on_too_old", max: BACKDATE_CEILING });
    }
    expect(maxBackdateDays(null)).toBe(366);
  });

  it("the owner can narrow it per role; owner and superadmins always a year", () => {
    const limits = normalizeBackdateLimits({ seller: 7, manager: 31 });
    expect(limits).toEqual({ seller: 7, manager: 31, supervisor: 366 });
    expect(cleanSoldOn({ date: "2026-11-10" }, NOW, TZ, "seller", limits)).toEqual({ reason: "sold_on_too_old", max: 7 });
    expect(cleanSoldOn({ date: "2026-11-11" }, NOW, TZ, "seller", limits)).not.toHaveProperty("reason");
    expect(cleanSoldOn({ date: "2026-10-17" }, NOW, TZ, "manager", limits)).toEqual({ reason: "sold_on_too_old", max: 31 });
    expect(maxBackdateDays("owner", { seller: 0, manager: 0, supervisor: 0 })).toBe(366);
    expect(maxBackdateDays("superadmin", { seller: 0, manager: 0, supervisor: 0 })).toBe(366);
    // 0 = that role cannot backdate at all.
    expect(cleanSoldOn({ date: "2026-11-17" }, NOW, TZ, "seller", { seller: 0, manager: 0, supervisor: 0 })).toEqual({ reason: "sold_on_too_old", max: 0 });
    expect(normalizeBackdateLimits({ seller: 500, manager: -1, supervisor: "x" })).toEqual({ seller: 366, manager: 366, supervisor: 366 });
    expect(backdateLimitsDenied({ seller: 400 })).toBe("bad_backdate_limits");
    expect(backdateLimitsDenied({ seller: 1.5 })).toBe("bad_backdate_limits");
    expect(backdateLimitsDenied(null)).toBe("bad_backdate_limits");
    expect(backdateLimitsDenied({ seller: 30, manager: 90 })).toBeNull();
  });

  it("when the money came in and whether it was already delivered", () => {
    const def = cleanSoldOn({ date: "2026-06-01" }, NOW, TZ, "seller");
    if (!def || "reason" in def) throw new Error("expected a backdate");
    expect(def).toMatchObject({ moneyOn: "sale", delivered: false });
    const today = cleanSoldOn({ date: "2026-06-01", money_on: "today", delivered: true }, NOW, TZ, "seller");
    if (!today || "reason" in today) throw new Error("expected a backdate");
    expect(today).toMatchObject({ moneyOn: "today", delivered: true });
    expect(cleanSoldOn({ date: "2026-06-01", money_on: "yesterday" }, NOW, TZ, "seller")).toEqual({ reason: "sold_on_invalid" });
    // The record keeps when it was really written, so a backdated sale is never mistaken for a sale of the day.
    const rec = backdateRecord(today, NOW, "user_1");
    expect(rec).toEqual({ recorded_at: NOW.toISOString(), by: "user_1", date: "2026-06-01", time: "12:00", note: null, money_on: "today", delivered: true });
  });

  it("rejects what is not a date, a time or a short note", () => {
    expect(cleanSoldOn({ date: "2026-02-30" }, NOW, TZ, "owner")).toEqual({ reason: "sold_on_invalid" });
    expect(cleanSoldOn({ date: "18/11/2026" }, NOW, TZ, "owner")).toEqual({ reason: "sold_on_invalid" });
    expect(cleanSoldOn({ date: "2026-11-17", time: "25:00" }, NOW, TZ, "owner")).toEqual({ reason: "sold_on_invalid" });
    expect(cleanSoldOn({ date: "2026-11-17", note: "x".repeat(201) }, NOW, TZ, "owner")).toEqual({ reason: "sold_on_invalid" });
    expect(cleanSoldOn("2026-11-17", NOW, TZ, "owner")).toEqual({ reason: "sold_on_invalid" });
  });

  it("the store's wall clock across daylight saving and at the turn of the day", () => {
    // 1-nov-2026 is the day Texas goes back to CST (UTC−6); 31-oct is still CDT (UTC−5).
    expect(zonedInstant("2026-10-31", "12:00", TZ).toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(zonedInstant("2026-11-02", "12:00", TZ).toISOString()).toBe("2026-11-02T18:00:00.000Z");
    // 23:30 in Texas is already the next day in UTC; it still counts as that local day.
    const late = zonedInstant("2026-11-10", "23:30", TZ);
    expect(localParts(late, TZ).date).toBe("2026-11-10");
    expect(daysBetween("2026-10-31", "2026-11-18")).toBe(18);
  });
});
