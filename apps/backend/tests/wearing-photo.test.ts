import { cleanWearingPhoto, WEARING_PHOTO_MAX_BYTES, wearingPhotoDenied } from "../src/lib/pos-wearing-photo";
import { salePermissions } from "../src/lib/sale-permissions";
import { toSale } from "../src/lib/pos-data";
import { limitedSale } from "../src/lib/pos-route";
import type { StaffRole } from "../src/lib/staff-roles";

const jpeg = `data:image/jpeg;base64,${Buffer.from("fake-jpeg-bytes").toString("base64")}`;

describe("cleanWearingPhoto", () => {
  it("needs the patient's consent", () => {
    expect(cleanWearingPhoto({ photo: jpeg })).toEqual({ reason: "wearing_photo_consent" });
    expect(cleanWearingPhoto({ photo: jpeg, consent: "true" })).toEqual({ reason: "wearing_photo_consent" });
  });
  it("accepts a JPEG / PNG / WebP data URL", () => {
    expect(cleanWearingPhoto({ photo: jpeg, consent: true })).toEqual({ photo: jpeg });
    expect(cleanWearingPhoto({ photo: jpeg.replace("jpeg", "png"), consent: true })).toHaveProperty("photo");
  });
  it("rejects anything else", () => {
    for (const photo of [null, 3, "https://x/y.jpg", "data:image/svg+xml;base64,PHN2Zz4=", "data:application/pdf;base64,AAAA", "data:image/jpeg;base64,"]) {
      expect(cleanWearingPhoto({ photo, consent: true })).toEqual({ reason: "bad_wearing_photo" });
    }
  });
  it("rejects a photo over the size limit", () => {
    const big = `data:image/jpeg;base64,${"A".repeat(Math.ceil(((WEARING_PHOTO_MAX_BYTES + 10) * 4) / 3))}`;
    expect(cleanWearingPhoto({ photo: big, consent: true })).toEqual({ reason: "bad_wearing_photo" });
  });
});

const actor = (role: StaffRole, extra: Partial<{ user_id: string; establishment_ids: string[] | null }> = {}) => ({
  user_id: "u_x",
  role,
  is_admin: role === "owner" || role === "superadmin",
  establishment_ids: ["est_1"],
  ...extra,
});
const sale = (status = "completed") => ({ seller_id: "u_seller", establishment_id: "est_1", status });

describe("wearingPhotoDenied", () => {
  it("the seller who made the sale may take it; a colleague may not", () => {
    expect(wearingPhotoDenied(actor("seller", { user_id: "u_seller" }), sale(), "seller", "set")).toBeNull();
    expect(wearingPhotoDenied(actor("seller"), sale(), "seller", "set")).toBe("edit_not_allowed");
    expect(wearingPhotoDenied(actor("manager"), sale(), "seller", "set")).toBeNull();
  });
  it("another store's staff may not", () => {
    expect(wearingPhotoDenied(actor("manager", { establishment_ids: ["est_2"] }), sale(), "seller", "set")).toBe("forbidden_store");
  });
  it("a voided sale: no new photo, but it may be removed", () => {
    expect(wearingPhotoDenied(actor("manager"), sale("voided"), "seller", "set")).toBe("sale_voided");
    expect(wearingPhotoDenied(actor("manager"), sale("voided"), "seller", "remove")).toBeNull();
    expect(salePermissions(actor("manager"), sale("voided"), "seller").can_wearing_photo).toBe(true);
  });
});

describe("the key never leaves the backend", () => {
  const row = { id: "poss_1", number: "Op1-000001", establishment_id: "est_1", total_cents: 100, status: "completed", created_at: "2026-11-09T12:00:00Z", wearing_photo_key: "poswear/abc.jpg", wearing_photo_at: "2026-11-09T12:01:00Z" };
  it("the sale says only whether there is one and when", () => {
    const s = toSale(row, []);
    expect(s.has_wearing_photo).toBe(true);
    expect(s.wearing_photo_at).toBe("2026-11-09T12:01:00.000Z");
    expect(JSON.stringify(s)).not.toContain("poswear/");
    expect(toSale({ ...row, wearing_photo_key: null }, []).has_wearing_photo).toBe(false);
  });
  it("the collection view tells the clerk handing over that there is a photo", () => {
    const s = toSale(row, []);
    expect(limitedSale(s, null, true).has_wearing_photo).toBe(true);
    expect(limitedSale(s, null, false)).not.toHaveProperty("has_wearing_photo");
  });
});
