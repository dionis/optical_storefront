import { axisDelta, monthsBetween, opticalChange, sphericalEquivalent } from "../src/lib/optical-change";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("axisDelta", () => {
  it("is circular on 0–180", () => {
    expect(axisDelta(175, 5)).toBe(10);
    expect(axisDelta(90, 90)).toBe(0);
    expect(axisDelta(0, 180)).toBe(0);
    expect(axisDelta(10, 100)).toBe(90);
  });

  it("is null when either axis is missing", () => {
    expect(axisDelta(null, 90)).toBeNull();
  });
});

describe("sphericalEquivalent", () => {
  it("is sph + cyl/2", () => {
    expect(sphericalEquivalent({ sph: -2, cyl: -1 })).toBe(-2.5);
    expect(sphericalEquivalent({ sph: 1.25 })).toBe(1.25);
    expect(sphericalEquivalent({ cyl: -1 })).toBeNull();
  });
});

describe("monthsBetween", () => {
  it("counts whole months", () => {
    expect(monthsBetween("2024-10-27", NOW)).toBe(24);
    expect(monthsBetween("2026-09-28", NOW)).toBe(0);
    expect(monthsBetween("2026-09-27", NOW)).toBe(1);
  });

  it("is null for an unknown or future date", () => {
    expect(monthsBetween(null, NOW)).toBeNull();
    expect(monthsBetween("2027-01-01", NOW)).toBeNull();
    expect(monthsBetween("not a date", NOW)).toBeNull();
  });
});

describe("opticalChange", () => {
  const worn = { od: { sph: -2, cyl: -0.5, axis: 90 }, os: { sph: -1.75, cyl: 0, axis: null }, rx_date: "2023-04-15" };

  it("small changes are not significant", () => {
    const r = opticalChange(worn, { od: { sph: -2.25, cyl: -0.5, axis: 95 }, os: { sph: -1.75 } }, { now: NOW });
    expect(r.od).toMatchObject({ sph: -0.25, cyl: 0, axis: 5, se: -0.25, significant: false });
    expect(r.significant).toBe(false);
    expect(r.months_since_worn).toBe(42);
  });

  it("a half-diopter move in one eye is significant", () => {
    const r = opticalChange(worn, { od: { sph: -2, cyl: -0.5, axis: 90 }, os: { sph: -2.25 } }, { now: NOW });
    expect(r.os.se).toBe(-0.5);
    expect(r.os.significant).toBe(true);
    expect(r.significant).toBe(true);
    expect(r.max_se).toBe(0.5);
  });

  it("axis only counts when there is real cylinder", () => {
    const lowCyl = opticalChange(
      { od: { sph: 0, cyl: -0.25, axis: 10 }, os: { sph: 0 } },
      { od: { sph: 0, cyl: -0.25, axis: 60 }, os: { sph: 0 } },
      { now: NOW }
    );
    expect(lowCyl.significant).toBe(false);
    const realCyl = opticalChange(
      { od: { sph: 0, cyl: -1, axis: 10 }, os: { sph: 0 } },
      { od: { sph: 0, cyl: -1, axis: 25 }, os: { sph: 0 } },
      { now: NOW }
    );
    expect(realCyl.significant).toBe(true);
  });

  it("an addition change counts", () => {
    const r = opticalChange(
      { od: { sph: 1, add: 1.5 }, os: { sph: 1, add: 1.5 } },
      { od: { sph: 1, add: 2 }, os: { sph: 1, add: 2 } },
      { now: NOW }
    );
    expect(r.od.add).toBe(0.5);
    expect(r.significant).toBe(true);
  });

  it("thresholds can be tuned by the owner", () => {
    const r = opticalChange(worn, { od: { sph: -2.25, cyl: -0.5, axis: 90 }, os: { sph: -1.75 } }, { now: NOW, thresholds: { se: 0.25 } });
    expect(r.significant).toBe(true);
  });
});
