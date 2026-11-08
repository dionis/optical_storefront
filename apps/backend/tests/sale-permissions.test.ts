import { creatorRank, saleAdminDenied, saleEditDenied, saleMoveDenied, salePermissions, type SaleActor } from "../src/lib/sale-permissions";
import { cleanDeleteInput, cleanDetailsPatch } from "../src/lib/pos-sale-admin";
import { isAllowedForRestrictedRole } from "../src/lib/staff-roles";

const STORE = "est_A";
const OTHER = "est_B";
const sale = (over: Partial<{ seller_id: string | null; establishment_id: string; status: string }> = {}) => ({ seller_id: "u_seller", establishment_id: STORE, status: "completed", ...over });
const actor = (role: SaleActor["role"], over: Partial<SaleActor> = {}): SaleActor => ({
  user_id: `u_${role}`,
  role,
  is_admin: role === "owner" || role === "superadmin",
  establishment_ids: role === "owner" || role === "superadmin" ? null : [STORE],
  ...over,
});

describe("saleEditDenied — the creator or someone above them", () => {
  it("lets the seller who made the sale edit it", () => {
    expect(saleEditDenied(actor("seller", { user_id: "u_seller" }), sale(), "seller")).toBeNull();
  });
  it("refuses another seller of the same store", () => {
    expect(saleEditDenied(actor("seller", { user_id: "u_other" }), sale(), "seller")).toBe("edit_not_allowed");
  });
  it("lets a manager, supervisor, superadmin and owner edit a seller's sale", () => {
    for (const r of ["manager", "supervisor", "superadmin", "owner"] as const) expect(saleEditDenied(actor(r), sale(), "seller")).toBeNull();
  });
  it("refuses a peer: a manager on another manager's sale", () => {
    expect(saleEditDenied(actor("manager"), sale({ seller_id: "u_mgr2" }), "manager")).toBe("edit_not_allowed");
  });
  it("refuses a superadmin on the owner's sale (nobody is above the owner)", () => {
    expect(saleEditDenied(actor("superadmin"), sale({ seller_id: "u_owner" }), "owner")).toBe("edit_not_allowed");
  });
  it("refuses someone above the creator but outside the sale's store", () => {
    expect(saleEditDenied(actor("manager", { establishment_ids: [OTHER] }), sale(), "seller")).toBe("forbidden_store");
  });
  it("treats a creator without a role as a seller: a seller still cannot, a manager can", () => {
    expect(creatorRank(null)).toBe(1);
    expect(saleEditDenied(actor("seller", { user_id: "u_x" }), sale(), null)).toBe("edit_not_allowed");
    expect(saleEditDenied(actor("manager"), sale(), null)).toBeNull();
  });
  it("refuses a voided sale and a person with no role", () => {
    expect(saleEditDenied(actor("owner"), sale({ status: "voided" }), "seller")).toBe("sale_voided");
    expect(saleEditDenied(actor(null, { user_id: "u_seller" }), sale(), "seller")).toBe("forbidden_sale");
  });
});

describe("delete, restore and move — owner and superadmin only", () => {
  it("admin roles only", () => {
    expect(saleAdminDenied({ role: "owner" })).toBeNull();
    expect(saleAdminDenied({ role: "superadmin" })).toBeNull();
    for (const r of ["supervisor", "manager", "seller", null] as const) expect(saleAdminDenied({ role: r })).toBe("admin_only");
  });
  it("move needs another active store with a sales channel, and a live sale", () => {
    const target = { id: OTHER, is_active: true, sales_channel_id: "sc_B" };
    expect(saleMoveDenied({ role: "owner" }, sale(), target)).toBeNull();
    expect(saleMoveDenied({ role: "supervisor" }, sale(), target)).toBe("admin_only");
    expect(saleMoveDenied({ role: "owner" }, sale(), { ...target, id: STORE })).toBe("same_store");
    expect(saleMoveDenied({ role: "owner" }, sale(), { ...target, is_active: false })).toBe("store_not_found");
    expect(saleMoveDenied({ role: "owner" }, sale(), null)).toBe("store_not_found");
    expect(saleMoveDenied({ role: "owner" }, sale(), { ...target, sales_channel_id: null })).toBe("store_without_channel");
    expect(saleMoveDenied({ role: "owner" }, sale({ status: "voided" }), target)).toBe("sale_voided");
  });
  it("salePermissions mirrors the rules", () => {
    expect(salePermissions(actor("seller", { user_id: "u_seller" }), sale(), "seller")).toEqual({ can_edit: true, can_delete: false, can_move: false });
    expect(salePermissions(actor("superadmin"), sale(), "seller")).toEqual({ can_edit: true, can_delete: true, can_move: true });
  });
});

describe("the /admin guard", () => {
  it("lets restricted roles reach the edit route but not delete, restore or move", () => {
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/sales/poss_1")).toBe(true);
    for (const a of ["delete", "restore", "move"]) expect(isAllowedForRestrictedRole("POST", `/admin/pos/sales/poss_1/${a}`)).toBe(false);
  });
});

describe("cleanDetailsPatch", () => {
  it("refuses an empty patch and bad values", () => {
    expect(cleanDetailsPatch({})).toEqual({ reason: "nothing_to_change" });
    expect(cleanDetailsPatch({ delivery: "drone" })).toEqual({ reason: "bad_delivery" });
    expect(cleanDetailsPatch({ promised_on: "2026-02-30" })).toEqual({ reason: "bad_promised_on" });
    expect(cleanDetailsPatch({ internal_note: "x".repeat(1001) })).toEqual({ reason: "note_too_long" });
    expect(cleanDetailsPatch({ prescription: { rx: {} as never } })).toEqual({ reason: "prescription_required" });
  });
  it("keeps valid values and clears with null or empty", () => {
    expect(cleanDetailsPatch({ promised_on: "2026-11-20", internal_note: "  call first  ", delivery: "pickup" })).toEqual({ patch: { promised_on: "2026-11-20", internal_note: "call first", delivery: "pickup" } });
    expect(cleanDetailsPatch({ promised_on: null, internal_note: "" })).toEqual({ patch: { promised_on: null, internal_note: null } });
  });
  it("validates the customer with the till's rules", () => {
    expect(cleanDetailsPatch({ customer: { first_name: "Ana", last_name: "Ruiz", email: "bad", phone: "8325550100" } })).toEqual({ reason: "customer_email" });
  });
});

describe("cleanDeleteInput", () => {
  it("needs a known reason, and a note for other", () => {
    expect(cleanDeleteInput({ reason: "nope" })).toEqual({ reason: "bad_delete_reason" });
    expect(cleanDeleteInput({ reason: "other" })).toEqual({ reason: "delete_note_required" });
    expect(cleanDeleteInput({ reason: "duplicate" })).toEqual({ why: "duplicate", note: null });
    expect(cleanDeleteInput({ reason: "other", note: " typo " })).toEqual({ why: "other", note: "typo" });
  });
});
