/**
 * Opening hours (lib/store-hours.ts) and promotions (lib/promotions.ts).
 */
import { cleanStoreHours, DEFAULT_HOURS, hoursStatus, localClock, weekLine, type StoreHours } from "../src/lib/store-hours";
import { applyPromotion, cleanPromotion, promoState, saleDiscountPct, SEED_PROMOTIONS, type Promotion } from "../src/lib/promotions";

const TZ = "America/Chicago";
const at = (iso: string) => new Date(iso);
const NAMES = ["L", "M", "X", "J", "V", "S", "D"];

describe("store hours", () => {
  it("accepts a week and special days, sorted", () => {
    const r = cleanStoreHours({ week: DEFAULT_HOURS.week, special: [{ date: "2026-12-25", closed: true, label: " Navidad " }, { date: "2026-12-24", open: "09:00", close: "13:00" }] });
    if ("reason" in r) throw new Error(r.reason);
    expect(r.hours?.special.map((s) => s.date)).toEqual(["2026-12-24", "2026-12-25"]);
    expect(r.hours?.special[1]).toEqual({ date: "2026-12-25", label: "Navidad", closed: true, open: null, close: null });
    expect(cleanStoreHours(null)).toEqual({ hours: null });
  });

  it("refuses bad times, closing before opening, bad or repeated dates", () => {
    expect(cleanStoreHours({ week: { ...DEFAULT_HOURS.week, tue: { open: "9:00", close: "18:00" } } })).toMatchObject({ reason: "bad_hours", day: "tue" });
    expect(cleanStoreHours({ week: { ...DEFAULT_HOURS.week, fri: { open: "18:00", close: "09:00" } } })).toMatchObject({ reason: "close_before_open", day: "fri" });
    expect(cleanStoreHours({ week: DEFAULT_HOURS.week, special: [{ date: "2026-02-30", closed: true }] })).toMatchObject({ reason: "bad_special_date" });
    expect(cleanStoreHours({ week: DEFAULT_HOURS.week, special: [{ date: "2026-12-25", closed: true }, { date: "2026-12-25", closed: true }] })).toMatchObject({ reason: "duplicate_special_date" });
    expect(cleanStoreHours("x")).toEqual({ reason: "bad_hours" });
  });

  it("reads the store's wall clock, not the server's", () => {
    // 02:30 UTC on Monday is still Sunday 20:30 in Texas.
    expect(localClock(at("2026-11-16T02:30:00Z"), TZ)).toEqual({ ymd: "2026-11-15", weekday: "sun", minutes: 20 * 60 + 30 });
  });

  it("says open / closed and when it closes or opens next", () => {
    const h = DEFAULT_HOURS;
    // Monday 16-nov-2026 10:00 Chicago = 16:00 UTC.
    expect(hoursStatus(h, at("2026-11-16T16:00:00Z"), TZ)).toMatchObject({ known: true, open: true, closes_at: "18:00" });
    // Monday 07:00 → opens today at 09:00.
    expect(hoursStatus(h, at("2026-11-16T13:00:00Z"), TZ).next_open).toEqual({ date: "2026-11-16", time: "09:00", today: true });
    // Saturday 15:00 → closed; Sunday closed → Monday 09:00.
    expect(hoursStatus(h, at("2026-11-21T21:00:00Z"), TZ)).toMatchObject({ open: false, next_open: { date: "2026-11-23", time: "09:00", today: false } });
    // Closing time itself is closed.
    expect(hoursStatus(h, at("2026-11-17T00:00:00Z"), TZ).open).toBe(false);
    expect(hoursStatus(null, new Date(), TZ).known).toBe(false);
  });

  it("a special day replaces its weekday", () => {
    const h: StoreHours = { ...DEFAULT_HOURS, special: [{ date: "2026-12-24", label: "Nochebuena", closed: false, open: "09:00", close: "13:00" }, { date: "2026-12-25", label: "Navidad", closed: true, open: null, close: null }] };
    const eve = hoursStatus(h, at("2026-12-24T20:00:00Z"), TZ); // 14:00 local
    expect(eve).toMatchObject({ open: false, special: { label: "Nochebuena" } });
    expect(eve.next_open).toEqual({ date: "2026-12-26", time: "10:00", today: false }); // 25 closed, 26 is a Saturday
  });

  it("writes the week in one line for the receipt", () => {
    expect(weekLine(DEFAULT_HOURS, NAMES, "cerrado")).toBe("L–V 09:00–18:00 · S 10:00–14:00 · D cerrado");
    expect(weekLine(null, NAMES, "cerrado")).toBe("");
  });
});

const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: "promo_1", name: "Compre 2, lleve 1", description: null, kind: "bogo", establishment_ids: null, starts_on: null, ends_on: null,
  is_active: true, pct: 100, buy_qty: 2, get_qty: 1, min_total_cents: null, min_purchases: null, value_cents: null, sort: 1, ...over,
});

describe("promotions", () => {
  const stores = ["est_a", "est_b"];

  it("cleans each kind", () => {
    expect(cleanPromotion({ name: "2x1", kind: "bogo", buy_qty: 2, get_qty: 1 }, stores)).toMatchObject({ promo: { kind: "bogo", pct: 100, buy_qty: 2, get_qty: 1, is_active: true } });
    expect(cleanPromotion({ name: "15 %", kind: "percent", pct: "15", establishment_ids: ["est_a"], starts_on: "2026-11-01", ends_on: "2026-11-30" }, stores)).toMatchObject({ promo: { pct: 15, establishment_ids: ["est_a"] } });
    expect(cleanPromotion({ name: "Examen", kind: "free_service", value: "50", pct: 30 }, stores)).toMatchObject({ promo: { pct: null, value_cents: 5000 } });
    expect(cleanPromotion({ name: "Regalo", kind: "gift", min_total: 150, is_active: false }, stores)).toMatchObject({ promo: { min_total_cents: 15000, is_active: false } });
  });

  it("refuses what makes no sense", () => {
    expect(cleanPromotion({ kind: "percent", pct: 10 }, stores)).toEqual({ reason: "promo_name_required" });
    expect(cleanPromotion({ name: "x", kind: "magic" }, stores)).toEqual({ reason: "bad_promo_kind" });
    expect(cleanPromotion({ name: "x", kind: "percent" }, stores)).toEqual({ reason: "bad_promo_pct" });
    expect(cleanPromotion({ name: "x", kind: "percent", pct: 150 }, stores)).toEqual({ reason: "bad_promo_pct" });
    expect(cleanPromotion({ name: "x", kind: "bogo", buy_qty: 0, get_qty: 1 }, stores)).toEqual({ reason: "bad_promo_qty" });
    expect(cleanPromotion({ name: "x", kind: "gift", establishment_ids: ["nope"] }, stores)).toEqual({ reason: "bad_promo_store" });
    expect(cleanPromotion({ name: "x", kind: "gift", starts_on: "2026-12-01", ends_on: "2026-11-01" }, stores)).toEqual({ reason: "promo_ends_before_start" });
    expect(cleanPromotion({ name: "x", kind: "gift", min_total: -1 }, stores)).toEqual({ reason: "bad_promo_min" });
  });

  it("runs only switched on, in its stores and within its dates (inclusive)", () => {
    expect(promoState(promo(), "2026-11-15", "est_a")).toBe("live");
    expect(promoState(promo({ is_active: false }), "2026-11-15")).toBe("off");
    expect(promoState(promo({ establishment_ids: ["est_b"] }), "2026-11-15", "est_a")).toBe("other_store");
    expect(promoState(promo({ starts_on: "2026-11-16" }), "2026-11-15")).toBe("scheduled");
    expect(promoState(promo({ ends_on: "2026-11-14" }), "2026-11-15")).toBe("ended");
    expect(promoState(promo({ starts_on: "2026-11-15", ends_on: "2026-11-15" }), "2026-11-15")).toBe("live");
  });

  it("applies with its conditions", () => {
    expect(applyPromotion(promo(), { listCents: 30000 })).toEqual({ reason: "promo_ref_required" });
    expect(applyPromotion(promo(), { listCents: 30000, ref: " V-12, V-13 " })).toMatchObject({ applied: { pct: 100, ref: "V-12, V-13" } });
    expect(applyPromotion(promo({ kind: "gift", pct: null, min_total_cents: 15000 }), { listCents: 14999 })).toEqual({ reason: "promo_min_total", min: 150 });
    expect(applyPromotion(promo({ kind: "free_service", pct: 20, value_cents: 5000 }), { listCents: 1 })).toMatchObject({ applied: { pct: null, value_cents: 5000, ref: null } });
  });

  it("never adds a discount and a promotion: the bigger wins", () => {
    expect(saleDiscountPct(10, 15)).toEqual({ pct: 15, source: "promotion" });
    expect(saleDiscountPct(20, 15)).toEqual({ pct: 20, source: "discount" });
    expect(saleDiscountPct(15, 15)).toEqual({ pct: 15, source: "promotion" });
    expect(saleDiscountPct(0, null)).toEqual({ pct: 0, source: null });
    expect(saleDiscountPct(5, null)).toEqual({ pct: 5, source: "discount" });
  });

  it("seeds five valid examples, one of each kind at least", () => {
    expect(SEED_PROMOTIONS).toHaveLength(5);
    for (const s of SEED_PROMOTIONS) {
      const c = cleanPromotion({ ...s, min_total: s.min_total_cents === null ? null : s.min_total_cents / 100, value: s.value_cents === null ? null : s.value_cents / 100 }, []);
      expect("promo" in c).toBe(true);
    }
    expect(new Set(SEED_PROMOTIONS.map((s) => s.kind))).toEqual(new Set(["bogo", "free_service", "gift", "percent"]));
  });
});

describe("promotion for returning patients («desde la N.ª compra», 18-nov-2026)", () => {
  const second = promo({ kind: "percent", pct: 10, buy_qty: null, get_qty: null, min_purchases: 2 });
  it("the first purchase does not qualify; from the second it does", () => {
    expect(applyPromotion(second, { listCents: 10000, priorPurchases: 0 })).toEqual({ reason: "promo_min_purchases", min: 2 });
    expect(applyPromotion(second, { listCents: 10000, priorPurchases: 1 })).toHaveProperty("applied");
    expect(applyPromotion(second, { listCents: 10000 })).toEqual({ reason: "promo_min_purchases", min: 2 });
  });
  it("cleanPromotion takes min_purchases 2–50", () => {
    const base = { name: "Cliente frecuente", kind: "percent", pct: 10 };
    expect(cleanPromotion({ ...base, min_purchases: 3 }, [])).toMatchObject({ promo: { min_purchases: 3 } });
    expect(cleanPromotion({ ...base, min_purchases: 1 }, [])).toEqual({ reason: "bad_promo_min_purchases" });
    expect(cleanPromotion({ ...base }, [])).toMatchObject({ promo: { min_purchases: null } });
  });
});
