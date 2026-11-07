import { examDue, groupPurchases, listRow, monthsBetween, PATIENT_RULES, summarize, tierOf, type PatientFactLike } from "../src/lib/patient-history";
import { isAllowedForRestrictedRole } from "../src/lib/staff-roles";
import { canSeePatients } from "../src/api/admin/patients/route";

const fact = (over: Partial<PatientFactLike>): PatientFactLike => ({
  order_id: "order_1", sale_id: "poss_1", sale_number: "Op1-000001", channel: "pos", establishment_id: "est_1",
  title: "DC409", brand: "Di Caprio", category: "frame", lens_design: null, lens_material: null, lens_photo: null, lens_ar: null,
  has_prescription: false, qty: 1, list_cents: 10000, discount_cents: 0, total_cents: 10000, status: "active", sold_at: "2026-01-10T15:00:00Z",
  ...over,
});

describe("patient history", () => {
  const facts = [
    fact({}),
    fact({ category: "lens", title: null, brand: null, lens_design: "sv", lens_material: "cr39", total_cents: 5000, has_prescription: true }),
    fact({ order_id: "order_2", sale_id: "poss_2", sale_number: "Op2-000004", establishment_id: "est_2", total_cents: 20000, sold_at: "2026-06-01T15:00:00Z" }),
    fact({ order_id: "order_3", sale_id: null, sale_number: null, channel: "web", establishment_id: null, total_cents: 9000, sold_at: "2026-08-01T15:00:00Z" }),
    fact({ order_id: "order_4", sale_number: "Op1-000009", total_cents: 70000, status: "voided", sold_at: "2026-09-01T15:00:00Z" }),
  ];

  it("groups sold lines into purchases, newest first, voided flagged", () => {
    const p = groupPurchases(facts);
    expect(p.map((x) => x.order_id)).toEqual(["order_4", "order_3", "order_2", "order_1"]);
    expect(p[0].status).toBe("voided");
    expect(p[3]).toMatchObject({ total_cents: 15000, has_prescription: true, channel: "pos" });
    expect(p[3].lines[1].lens).toEqual({ design: "sv", material: "cr39", photo: null, ar: null });
    expect(p[1].channel).toBe("web");
  });

  it("totals, average ticket and stores skip voided sales", () => {
    const s = summarize(groupPurchases(facts), new Date("2026-11-07T12:00:00Z"));
    expect(s).toMatchObject({ purchases: 3, voided: 1, total_cents: 44000, avg_cents: 14667, with_prescription: 1, main_store: "est_2", tier: "vip", lapsed: false });
    expect(s.first_at).toBe("2026-01-10T15:00:00.000Z");
    expect(s.last_at).toBe("2026-08-01T15:00:00.000Z");
    expect(s.months_since_last).toBe(3);
    expect(s.stores.map((x) => x.channel)).toEqual(["pos", "pos", "web"]);
  });

  it("bands: new, returning, VIP by purchases or money, lapsed after two years", () => {
    expect(tierOf(0, 0)).toBe("none");
    expect(tierOf(1, 10000)).toBe("new");
    expect(tierOf(2, 10000)).toBe("returning");
    expect(tierOf(PATIENT_RULES.vipPurchases, 1)).toBe("vip");
    expect(tierOf(1, PATIENT_RULES.vipTotalCents)).toBe("vip");
    expect(listRow({ customer_id: "c", purchases: 1, total_cents: 5000, first_at: "2023-01-01", last_at: "2024-01-01" }, new Date("2026-11-07"))).toMatchObject({ lapsed: true, avg_cents: 5000, tier: "new" });
    expect(listRow({ customer_id: "c", purchases: 0, total_cents: 0, first_at: null, last_at: null })).toMatchObject({ avg_cents: null, tier: "none", lapsed: false });
    expect(summarize([]).avg_cents).toBeNull();
  });

  it("months between and the next eye exam", () => {
    expect(monthsBetween("2026-01-31T00:00:00Z", "2026-02-28T00:00:00Z")).toBe(0);
    expect(monthsBetween("2026-01-15T00:00:00Z", "2026-03-15T00:00:00Z")).toBe(2);
    expect(examDue({ rx_date: "2025-10-01", created_at: "2025-10-02T00:00:00Z" }, new Date("2026-11-07"))).toEqual({ due_on: "2026-10-01", overdue: true });
    expect(examDue({ rx_date: null, created_at: "2026-06-01T10:00:00Z" }, new Date("2026-11-07"))).toEqual({ due_on: "2027-06-01", overdue: false });
    expect(examDue(null)).toBeNull();
  });

  it("supervisors and managers open patient files at the guard; the route keeps sellers out", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/patients?q=ana")).toBe(true);
    expect(isAllowedForRestrictedRole("GET", "/admin/patients/cus_1")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/patients/cus_1")).toBe(false);
    expect(isAllowedForRestrictedRole("GET", "/admin/patients/cus_1/extra")).toBe(false);
    expect(canSeePatients({ is_admin: true, role: "superadmin" })).toBe(true);
    expect(canSeePatients({ is_admin: false, role: "supervisor" })).toBe(true);
    expect(canSeePatients({ is_admin: false, role: "manager" })).toBe(true);
    expect(canSeePatients({ is_admin: false, role: "seller" })).toBe(false);
  });
});
