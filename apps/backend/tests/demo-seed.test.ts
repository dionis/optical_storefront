import { allocateShared, cleanCostItem } from "../src/lib/store-costs";
import { cleanCustomer } from "../src/lib/pos";
import { validatePrescription } from "../src/modules/prescription/validation";
import {
  databaseFingerprint,
  demoCostItems,
  demoPerson,
  demoRx,
  demoSeedConfirmed,
  demoSeedRefusal,
  FORBIDDEN_DATABASES,
  isDemoOrder,
  MAX_FOREIGN_ORDERS,
  NOTIFICATION_VARS,
  salesPerDay,
  seededRng,
  STAGING_DATABASES,
} from "../src/lib/demo-seed";

/**
 * The guard is what keeps invented sales off the real store, so every way of
 * pointing the script somewhere else must be a refusal.
 */
describe("demo seed guard", () => {
  const other = "postgres://postgres.abc:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres";
  const local = "postgres://postgres:pw@localhost:54329/demo_seed";

  it("refuses any database that is not on the list", () => {
    expect(demoSeedRefusal({ databaseUrl: other })).toBe("not_staging_database");
    expect(demoSeedRefusal({ databaseUrl: "postgres://u:p@db.example.net:5432/postgres" })).toBe("not_staging_database");
  });

  it("fails closed when the address is missing or unreadable", () => {
    expect(demoSeedRefusal({ databaseUrl: undefined })).toBe("bad_database_url");
    expect(demoSeedRefusal({ databaseUrl: "" })).toBe("bad_database_url");
    expect(demoSeedRefusal({ databaseUrl: "not a url" })).toBe("bad_database_url");
  });

  it("allows only a throwaway database on this machine", () => {
    expect(demoSeedRefusal({ databaseUrl: local })).toBeNull();
    expect(demoSeedRefusal({ databaseUrl: "postgres://u:p@localhost.evil.net:5432/x" })).toBe("not_staging_database");
  });

  it("never has a database on both lists", () => {
    expect(STAGING_DATABASES.filter((f) => FORBIDDEN_DATABASES.includes(f))).toEqual([]);
    expect(STAGING_DATABASES.length).toBeGreaterThan(0);
    expect(FORBIDDEN_DATABASES.length).toBeGreaterThan(0);
  });

  it("the fingerprint depends on who, where and which database, not on the password", () => {
    const a = "postgres://postgres.abc:one@host.example.com:5432/postgres";
    expect(databaseFingerprint(a)).toBe(databaseFingerprint("postgres://postgres.abc:two@host.example.com:6543/postgres"));
    expect(databaseFingerprint(a)).not.toBe(databaseFingerprint("postgres://postgres.xyz:one@host.example.com:5432/postgres"));
    expect(databaseFingerprint(a)).not.toBe(databaseFingerprint("postgres://postgres.abc:one@host.example.com:5432/other"));
  });

  it("refuses a live Stripe key, a database full of orders, or one without stores", () => {
    expect(demoSeedRefusal({ databaseUrl: local, stripeKey: "sk_live_x" })).toBe("live_stripe_key");
    expect(demoSeedRefusal({ databaseUrl: local, stripeKey: "rk_live_x" })).toBe("live_stripe_key");
    expect(demoSeedRefusal({ databaseUrl: local, stripeKey: "sk_test_x" })).toBeNull();
    expect(demoSeedRefusal({ databaseUrl: local, foreignOrders: MAX_FOREIGN_ORDERS + 1 })).toBe("too_many_foreign_orders");
    expect(demoSeedRefusal({ databaseUrl: local, foreignOrders: 0, stores: 0 })).toBe("no_stores");
  });

  it("refuses to run with mail, SMS or Sheet credentials loaded", () => {
    for (const k of NOTIFICATION_VARS) expect(demoSeedRefusal({ databaseUrl: local, env: { [k]: "x" } })).toBe("live_notifications");
    expect(demoSeedRefusal({ databaseUrl: local, env: { RESEND_API_KEY: "" } })).toBeNull();
  });

  it("writes only with the exact target typed", () => {
    expect(demoSeedConfirmed(local, "localhost:54329/demo_seed")).toBe(true);
    expect(demoSeedConfirmed(local, undefined)).toBe(false);
    expect(demoSeedConfirmed(local, "yes")).toBe(false);
    expect(demoSeedConfirmed(local, "localhost:54329/other")).toBe(false);
  });

  it("recognizes a demo order only by its own marker", () => {
    expect(isDemoOrder({ demo_seed: true })).toBe(true);
    for (const md of [null, undefined, {}, { demo_seed: "true" }, { demo_seed: false }]) expect(isDemoOrder(md as never)).toBe(false);
  });
});

/** What it invents has to pass the same validation a real sale goes through. */
describe("demo seed data", () => {
  it("is reproducible", () => {
    expect(demoPerson(seededRng(7), 1)).toEqual(demoPerson(seededRng(7), 1));
  });

  it("invents customers the till accepts, whose email and phone reach nobody", () => {
    const rng = seededRng(1);
    for (let i = 0; i < 200; i++) {
      const p = demoPerson(rng, i);
      const res = cleanCustomer(p);
      expect("customer" in res).toBe(true);
      expect(p.email.endsWith("@example.com")).toBe(true);
      expect(p.phone).toMatch(/555-01\d\d$/);
    }
  });

  it("invents prescriptions the lab can cut", () => {
    const rng = seededRng(2);
    for (let i = 0; i < 300; i++) {
      const multifocal = i % 2 === 0;
      const rx = demoRx(rng, multifocal);
      const res = validatePrescription({ ...rx, id: "x" } as never, undefined, multifocal ? { usage_type: "progressive" } : {});
      expect(res.fulfillable).toBe(true);
    }
  });

  it("spreads sales by weekday, closes on Sundays and always sells today", () => {
    const counts = salesPerDay(seededRng(3), [1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 3], 40);
    expect(counts[6]).toBe(0);
    expect(counts[counts.length - 1]).toBeGreaterThan(0);
    expect(Math.abs(counts.reduce((s, n) => s + n, 0) - 40)).toBeLessThanOrEqual(5);
  });

  it("invents cost items the Costs tab accepts", () => {
    for (const it of demoCostItems("own", 1, "2026-08-01")) {
      expect("item" in cleanCostItem({ ...it, establishment_id: "est_1" }, ["est_1"])).toBe(true);
    }
    expect(demoCostItems("family", 1, "2026-08-01").some((i) => i.category === "rent")).toBe(false);
    expect([...allocateShared(100, { method: "sales" }, ["a"], new Map()).values()]).toEqual([100]);
  });
});
