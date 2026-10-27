import {
  EMPTY_PROFILE,
  cleanProfilePatch,
  hasPrivilege,
  suggestSellerCode,
  viewProfile,
  type StaffProfileData,
} from "../src/lib/staff-profile";

const full: StaffProfileData = {
  ...EMPTY_PROFILE,
  display_name: "Carlos M.",
  seller_code: "CM07",
  phone_mobile: "+1 832 555 0101",
  alert_email: "carlos@example.com",
  commission_pct: 3,
  privileges: ["sale.void"],
  emergency_name: "Ana",
  internal_notes: "note",
};

describe("cleanProfilePatch", () => {
  it("lets a person edit only contact and preferences", () => {
    expect(cleanProfilePatch({ phone_mobile: " (832) 555-0101 ", locale: "en" }, "self")).toEqual({
      patch: { phone_mobile: "(832) 555-0101", locale: "en" },
    });
    expect(cleanProfilePatch({ seller_code: "CM07" }, "self")).toEqual({ reason: "forbidden_field", field: "seller_code" });
    expect(cleanProfilePatch({ privileges: ["costs.manage"] }, "self")).toEqual({ reason: "forbidden_field", field: "privileges" });
  });

  it("validates what admins write", () => {
    expect(cleanProfilePatch({ seller_code: "cm07", privileges: ["costs.view", "costs.view"] }, "admin")).toEqual({
      patch: { seller_code: "CM07", privileges: ["costs.view"] },
    });
    expect(cleanProfilePatch({ seller_code: "C-7" }, "admin")).toEqual({ reason: "bad_seller_code", field: "seller_code" });
    expect(cleanProfilePatch({ alert_email: "nope" }, "admin")).toEqual({ reason: "bad_email", field: "alert_email" });
    expect(cleanProfilePatch({ commission_pct: 120 }, "admin")).toEqual({ reason: "bad_number", field: "commission_pct" });
  });

  it("approving discounts is not a grantable privilege", () => {
    expect(cleanProfilePatch({ privileges: ["discount.approve"] }, "admin")).toEqual({ reason: "bad_privileges", field: "privileges" });
  });
});

describe("viewProfile", () => {
  it("shows a teammate only identity", () => {
    expect(viewProfile(full, { isAdmin: false, isSelf: false, managesThem: false })).toEqual({ display_name: "Carlos M.", seller_code: "CM07" });
  });

  it("a manager of their store also sees contact", () => {
    const v = viewProfile(full, { isAdmin: false, isSelf: false, managesThem: true });
    expect(v.phone_mobile).toBe("+1 832 555 0101");
    expect(v.alert_email).toBeUndefined();
    expect(v.commission_pct).toBeUndefined();
  });

  it("the person sees work terms but not the emergency contact or notes", () => {
    const v = viewProfile(full, { isAdmin: false, isSelf: true, managesThem: false });
    expect(v.commission_pct).toBe(3);
    expect(v.emergency_name).toBeUndefined();
    expect(v.internal_notes).toBeUndefined();
  });

  it("admins see everything", () => {
    expect(viewProfile(full, { isAdmin: true, isSelf: false, managesThem: false })).toMatchObject({ emergency_name: "Ana", internal_notes: "note" });
  });
});

describe("suggestSellerCode", () => {
  it("initials plus the next free number", () => {
    expect(suggestSellerCode("Carlos", "Méndez", [])).toBe("CM01");
    expect(suggestSellerCode("Carlos", "Méndez", ["CM01", "cm02"])).toBe("CM03");
    expect(suggestSellerCode(null, null, [])).toBe("V01");
  });
});

describe("hasPrivilege", () => {
  it("admins hold every privilege; others what they were given", () => {
    expect(hasPrivilege({ is_admin: true, privileges: [] }, "costs.manage")).toBe(true);
    expect(hasPrivilege({ is_admin: false, privileges: ["costs.view"] }, "costs.view")).toBe(true);
    expect(hasPrivilege({ is_admin: false, privileges: ["costs.view"] }, "costs.manage")).toBe(false);
  });
});
