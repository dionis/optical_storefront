/**
 * Store status: what needs attention in a store. Pure — no database.
 */
import { LONG_OPEN_REGISTER_HOURS, storeAttention } from "../src/lib/store-status";

const now = new Date("2026-10-29T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const register = (h: number, shared = false) => ({ id: "c", opened_at: hoursAgo(h), opening: 50, expected: 50, cash_in_sales: 0, shared });
const base = { sellers: [], approvals_pending: 0, voids_requested: 0, ready: 0 };
const kinds = (a: ReturnType<typeof storeAttention>) => a.map((x) => x.kind);

describe("storeAttention", () => {
  it("is empty for a healthy store", () => {
    expect(storeAttention({ ...base, tills: [{ code: "Op1-POS1", is_active: true, register: register(2) }] }, now)).toEqual([]);
  });

  it("flags a store with no active till first", () => {
    const a = storeAttention({ ...base, approvals_pending: 1, tills: [{ code: "Op1-POS1", is_active: false, register: null }] }, now);
    expect(kinds(a)).toEqual(["no_active_till", "approvals_pending"]);
    expect(a[0].tone).toBe("bad");
  });

  it("flags a register left open overnight, with its hours and till", () => {
    const a = storeAttention({ ...base, tills: [{ code: "Op1-POS2", is_active: true, register: register(LONG_OPEN_REGISTER_HOURS + 3) }] }, now);
    expect(a).toEqual([{ kind: "register_open_long", n: LONG_OPEN_REGISTER_HOURS + 3, ref: "Op1-POS2", tone: "bad" }]);
  });

  it("lists pending work and locked-out counter sellers", () => {
    const a = storeAttention(
      {
        tills: [{ code: "Op1-POS1", is_active: true, register: register(1) }],
        sellers: [{ code: "ANA", active: false, has_user: true }, { code: "REF", active: false, has_user: false }],
        approvals_pending: 2,
        voids_requested: 1,
        ready: 3,
      },
      now
    );
    expect(kinds(a)).toEqual(["approvals_pending", "voids_requested", "counter_seller_inactive", "ready_to_hand"]);
    expect(a.find((x) => x.kind === "counter_seller_inactive")?.ref).toBe("ANA");
  });

  it("counts the store-wide register once: open long is one warning for the store, not one per till", () => {
    const a = storeAttention({ ...base, tills: [
      { code: "Op1-POS1", is_active: true, register: register(LONG_OPEN_REGISTER_HOURS + 1, true) },
      { code: "Op1-POS2", is_active: true, register: register(LONG_OPEN_REGISTER_HOURS + 1, true) },
    ] }, now);
    expect(a).toEqual([{ kind: "register_open_long", n: LONG_OPEN_REGISTER_HOURS + 1, ref: undefined, tone: "bad" }]);
  });

  it("a store-wide register open on every active till means no till is without register", () => {
    const a = storeAttention({ ...base, tills: [
      { code: "Op1-POS1", is_active: true, register: register(1, true) },
      { code: "Op1-POS2", is_active: true, register: register(1, true) },
      { code: "Op1-POS3", is_active: false, register: null },
    ] }, now);
    expect(a).toEqual([]);
  });

  it("notes when no active till has its register open", () => {
    const a = storeAttention({ ...base, tills: [{ code: "Op1-POS1", is_active: true, register: null }, { code: "Op1-POS2", is_active: true, register: null }] }, now);
    expect(a).toEqual([{ kind: "till_without_register", n: 2, tone: "info" }]);
  });
});
