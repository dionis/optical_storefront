import { cleanRule, defaultRules, localParts, ruleMatches, storeIdle, summaryDue, type RuleLike } from "../src/lib/alerts";

const TZ = "America/Chicago";
const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: "alr_1",
  event: "sale.created",
  conditions: {},
  establishment_ids: null,
  seller_ids: null,
  recipients: ["owner@example.com"],
  mode: "immediate",
  schedule: null,
  is_active: true,
  last_sent_at: null,
  ...over,
});
const sale = (over: Record<string, unknown> = {}) => ({
  event: "sale.created" as const,
  key: "sale:poss_1",
  establishment_id: "est_2",
  seller_id: "user_1",
  data: { total: 202.5, discount_pct: 10 },
  ...over,
});

describe("ruleMatches", () => {
  it("every sale of the watched stores", () => {
    expect(ruleMatches(rule({}), sale())).toBe(true);
    expect(ruleMatches(rule({ establishment_ids: ["est_1"] }), sale())).toBe(false);
    expect(ruleMatches(rule({ is_active: false }), sale())).toBe(false);
  });

  it("large sales only (HU-42: venta mayor a $300)", () => {
    expect(ruleMatches(rule({ conditions: { min_total: 300 } }), sale())).toBe(false);
    expect(ruleMatches(rule({ conditions: { min_total: 300 } }), sale({ data: { total: 450 } }))).toBe(true);
  });

  it("high discounts only (HU-42: descuento mayor al 15 %)", () => {
    const r = rule({ event: "discount.applied", conditions: { min_discount_pct: 15 } });
    expect(ruleMatches(r, sale({ event: "discount.applied" }))).toBe(false);
    expect(ruleMatches(r, sale({ event: "discount.applied", data: { discount_pct: 20 } }))).toBe(true);
  });

  it("web orders only when the rule asks for them", () => {
    expect(ruleMatches(rule({}), sale({ is_web: true, establishment_id: null }))).toBe(false);
    expect(ruleMatches(rule({ conditions: { include_web: true } }), sale({ is_web: true, establishment_id: null }))).toBe(true);
  });
});

describe("cleanRule", () => {
  const opts = { canSchedule: true, allowedStores: null, knownStores: ["est_1", "est_2"] };

  it("keeps the addresses the author wrote, de-duplicated (HU-41)", () => {
    const r = cleanRule({ name: "Ventas Op2", event: "sale.created", recipients: "A@x.com, b@x.com; a@x.com", establishment_ids: ["est_2"] }, opts);
    expect("rule" in r && r.rule).toMatchObject({ recipients: ["a@x.com", "b@x.com"], establishment_ids: ["est_2"], mode: "immediate" });
  });

  it("validates frequency: 1–12 hours, daily or weekly at a time", () => {
    expect(cleanRule({ name: "x", event: "sale.created", recipients: ["a@x.com"], mode: "every_n_hours", schedule: { hours: 13 } }, opts)).toEqual({ reason: "bad_schedule" });
    const r = cleanRule({ name: "x", event: "sale.created", recipients: ["a@x.com"], mode: "weekly", schedule: { weekday: 1, at: "08:30" } }, opts);
    expect("rule" in r && r.rule.schedule).toEqual({ weekday: 1, at: "08:30" });
  });

  it("a discount waiting for approval is always immediate", () => {
    const r = cleanRule({ name: "x", event: "discount.requested", recipients: ["a@x.com"], mode: "daily", schedule: { at: "20:00" } }, opts);
    expect("rule" in r && r.rule.mode).toBe("immediate");
  });

  it("a supervisor cannot change the frequency nor watch other stores", () => {
    const sup = { canSchedule: false, allowedStores: ["est_2"], knownStores: ["est_1", "est_2"] };
    const r = cleanRule({ name: "x", event: "sale.created", recipients: ["a@x.com"], mode: "daily", schedule: { at: "20:00" } }, sup);
    expect("rule" in r && r.rule).toMatchObject({ mode: "immediate", establishment_ids: ["est_2"] });
    expect(cleanRule({ name: "x", event: "sale.created", recipients: ["a@x.com"], establishment_ids: ["est_1"] }, sup)).toEqual({ reason: "forbidden_store" });
  });

  it("refuses bad addresses", () => {
    expect(cleanRule({ name: "x", event: "sale.created", recipients: ["nope"] }, opts)).toEqual({ reason: "bad_recipient" });
    expect(cleanRule({ name: "x", event: "sale.created", recipients: [] }, opts)).toEqual({ reason: "recipients_required" });
  });
});

describe("schedules in Katy time", () => {
  // 2026-10-27 is CDT (UTC-5): 20:05 local = 01:05 UTC next day.
  it("local parts", () => {
    expect(localParts(new Date("2026-10-28T01:05:00Z"), TZ)).toMatchObject({ date: "2026-10-27", hour: 20, minute: 5 });
  });

  it("a daily summary at 20:00 goes once a day", () => {
    const daily = { mode: "daily" as const, schedule: { at: "20:00" }, last_sent_at: null };
    expect(summaryDue(daily, new Date("2026-10-28T00:30:00Z"), TZ)).toBe(false); // 19:30
    expect(summaryDue(daily, new Date("2026-10-28T01:05:00Z"), TZ)).toBe(true); // 20:05
    expect(summaryDue({ ...daily, last_sent_at: "2026-10-28T01:05:00Z" }, new Date("2026-10-28T03:00:00Z"), TZ)).toBe(false);
  });

  it("every N hours", () => {
    const r = { mode: "every_n_hours" as const, schedule: { hours: 3 }, last_sent_at: "2026-10-27T10:00:00Z" };
    expect(summaryDue(r, new Date("2026-10-27T12:00:00Z"), TZ)).toBe(false);
    expect(summaryDue(r, new Date("2026-10-27T13:00:00Z"), TZ)).toBe(true);
  });

  it("a store with no sale today after 14:00 (HU-42)", () => {
    const now = new Date("2026-10-27T20:00:00Z"); // 15:00 local
    expect(storeIdle({ now, tz: TZ, idleAfter: "14:00", lastSaleAt: new Date("2026-10-26T22:00:00Z") })).toBe(true);
    expect(storeIdle({ now, tz: TZ, idleAfter: "14:00", lastSaleAt: new Date("2026-10-27T15:00:00Z") })).toBe(false);
    expect(storeIdle({ now, tz: TZ, idleAfter: "16:00", lastSaleAt: null })).toBe(false);
  });
});

describe("defaultRules", () => {
  it("are the owner's agreed starting set", () => {
    const rules = defaultRules(["owner@example.com"], "es");
    expect(rules.map((r) => [r.event, r.mode])).toEqual([
      ["sale.created", "immediate"],
      ["discount.requested", "immediate"],
      ["sale.voided", "immediate"],
      ["cash.diff", "immediate"],
      ["digest", "daily"],
    ]);
    expect(rules[4].schedule).toEqual({ at: "20:00" });
  });
});
