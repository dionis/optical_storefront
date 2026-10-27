import { DEFAULT_DISCOUNT_LIMITS, discountLimitFor, normalizeLimits, normalizeThresholds, settingsDenied } from "../src/lib/pos-settings";
import { belowMinimum, lineMinimum, minimumDenied, type PriceRuleLike } from "../src/lib/store-pricing";

describe("discount limits (HU-16)", () => {
  it("start at the owner's agreed values", () => {
    expect(DEFAULT_DISCOUNT_LIMITS).toEqual({ seller: 10, manager: 15, supervisor: 20 });
    expect(normalizeLimits(null)).toEqual(DEFAULT_DISCOUNT_LIMITS);
  });

  it("are clamped to 0–50 and validated on edit", () => {
    expect(normalizeLimits({ seller: 70, manager: -5, supervisor: "12.5" })).toEqual({ seller: 50, manager: 0, supervisor: 12.5 });
    expect(settingsDenied({ discount_limits: { seller: 60 } })).toBe("bad_limits");
    expect(settingsDenied({ discount_limits: { seller: 12 } })).toBeNull();
  });

  it("a personal limit beats the role's; admins have none", () => {
    const limits = { seller: 10, manager: 15, supervisor: 20 };
    expect(discountLimitFor({ is_admin: false, role: "seller", discount_limit_pct: null }, limits)).toBe(10);
    expect(discountLimitFor({ is_admin: false, role: "seller", discount_limit_pct: 18 }, limits)).toBe(18);
    expect(discountLimitFor({ is_admin: false, role: "manager", discount_limit_pct: null }, limits)).toBe(15);
    expect(discountLimitFor({ is_admin: true, role: "superadmin", discount_limit_pct: null }, limits)).toBeNull();
  });
});

describe("optical thresholds (HU-123)", () => {
  it("keep the defaults for anything missing or out of range", () => {
    expect(normalizeThresholds({ se: 0.75, axis: 200 })).toEqual({ se: 0.75, cyl: 0.5, axis: 10, axisMinCyl: 0.75, add: 0.5 });
    expect(settingsDenied({ optical_thresholds: { se: 0 } })).toBe("bad_thresholds");
  });
});

describe("minimum price (HU-16)", () => {
  const at = "2026-01-01T00:00:00Z";
  const rule = (r: Partial<PriceRuleLike>): PriceRuleLike => ({ establishment_id: null, scope: "frame", target: "prod_1", mode: "min", value: 30, valid_from: at, valid_to: null, ...r });

  it("the store's minimum wins over the global one", () => {
    const rules = [rule({}), rule({ establishment_id: "est_2", value: 34 }), rule({ scope: "all", target: null, value: 70 })];
    expect(lineMinimum(rules, { establishmentId: "est_2", scope: "frame", target: "prod_1" })).toEqual({ frame_min: 34, floor_pct: 70 });
    expect(lineMinimum(rules, { establishmentId: "est_1", scope: "frame", target: "prod_1" })).toEqual({ frame_min: 30, floor_pct: 70 });
  });

  it("flags a discounted line under either minimum", () => {
    expect(belowMinimum({ frame_min: 30, floor_pct: null }, { list: 225, frame: 29, total: 200 })).toBe(true);
    expect(belowMinimum({ frame_min: null, floor_pct: 90 }, { list: 225, frame: 36, total: 202.5 })).toBe(false);
    expect(belowMinimum({ frame_min: null, floor_pct: 95 }, { list: 225, frame: 36, total: 202.5 })).toBe(true);
  });

  it("validates a minimum", () => {
    expect(minimumDenied("all", null, 70)).toBeNull();
    expect(minimumDenied("all", null, 120)).toBe("bad_value");
    expect(minimumDenied("frame", "", 30)).toBe("bad_target");
  });
});
