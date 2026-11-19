import { BACKDATE_MAX_DAYS, cleanSoldOn, daysBetween, maxBackdateDays, zonedInstant } from "../src/lib/sale-date";
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

  it("never the future; never further back than the role allows", () => {
    expect(cleanSoldOn({ date: "2026-11-19" }, NOW, TZ, "owner")).toEqual({ reason: "sold_on_future" });
    expect(cleanSoldOn({ date: "2026-11-10" }, NOW, TZ, "seller")).toEqual({ reason: "sold_on_too_old", max: 7 });
    expect(cleanSoldOn({ date: "2026-11-11" }, NOW, TZ, "seller")).not.toHaveProperty("reason");
    expect(cleanSoldOn({ date: "2026-10-18" }, NOW, TZ, "manager")).not.toHaveProperty("reason");
    expect(cleanSoldOn({ date: "2026-10-17" }, NOW, TZ, "supervisor")).toEqual({ reason: "sold_on_too_old", max: 31 });
    expect(cleanSoldOn({ date: "2025-11-18" }, NOW, TZ, "superadmin")).not.toHaveProperty("reason");
    expect(maxBackdateDays(null)).toBe(BACKDATE_MAX_DAYS.seller);
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
