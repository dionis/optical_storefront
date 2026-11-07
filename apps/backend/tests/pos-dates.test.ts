import { localDateISO, localYear, promisedDate } from "../src/lib/pos";

const TZ = "America/Chicago";

describe("store-local dates (the server runs in UTC)", () => {
  it("an evening sale in Texas keeps Texas's date", () => {
    // 2026-11-04T23:45Z = 5:45 pm CST on the 4th; UTC already says the 4th too.
    expect(localDateISO(new Date("2026-11-04T23:45:00Z"), TZ)).toBe("2026-11-04");
    // 2026-11-05T03:30Z = 9:30 pm CST on the 4th; UTC says the 5th.
    expect(localDateISO(new Date("2026-11-05T03:30:00Z"), TZ)).toBe("2026-11-04");
    expect(new Date("2026-11-05T03:30:00Z").toISOString().slice(0, 10)).toBe("2026-11-05");
  });

  it("the Rx sequence year turns at the store's midnight, not UTC's", () => {
    expect(localYear(new Date("2027-01-01T04:00:00Z"), TZ)).toBe(2026);
    expect(localYear(new Date("2027-01-01T06:00:00Z"), TZ)).toBe(2027);
  });

  it("the promised date counts business days from the store's date", () => {
    // Wednesday 4 Nov 2026 at 7 pm Chicago (= 01:00Z on the 5th).
    const sale = new Date("2026-11-05T01:00:00Z");
    expect(promisedDate(sale, TZ, 0)).toBe("2026-11-04");
    // 10 business days after Wed 4 Nov → Wed 18 Nov.
    expect(promisedDate(sale, TZ, 10)).toBe("2026-11-18");
    // A Friday + 1 business day skips the weekend.
    expect(promisedDate(new Date("2026-11-06T20:00:00Z"), TZ, 1)).toBe("2026-11-09");
  });

  it("an unknown timezone falls back to UTC rather than stopping the till", () => {
    expect(localDateISO(new Date("2026-11-05T03:30:00Z"), "Not/AZone")).toBe("2026-11-05");
  });
});
