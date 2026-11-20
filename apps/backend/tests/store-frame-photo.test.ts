import { isAllowedForRestrictedRole } from "../src/lib/staff-roles";
import { parseStoreFramePhoto, STORE_FRAME_PHOTO_MAX_BYTES } from "../src/lib/store-frame-photo";

describe("parseStoreFramePhoto", () => {
  const jpg = `data:image/jpeg;base64,${Buffer.from("fake").toString("base64")}`;
  it("accepts JPEG / PNG / WebP data URLs", () => {
    expect(parseStoreFramePhoto(jpg)).toMatchObject({ mime: "image/jpeg", ext: "jpg" });
    expect(parseStoreFramePhoto(jpg.replace("jpeg", "png"))).toMatchObject({ mime: "image/png", ext: "png" });
    expect(parseStoreFramePhoto(jpg.replace("jpeg", "jpg"))).toMatchObject({ mime: "image/jpeg" });
  });
  it("refuses anything else or too large", () => {
    for (const v of [null, 4, "https://x/y.jpg", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/jpeg;base64,"]) expect(parseStoreFramePhoto(v)).toBeNull();
    expect(parseStoreFramePhoto(`data:image/jpeg;base64,${"A".repeat(Math.ceil(((STORE_FRAME_PHOTO_MAX_BYTES + 9) * 4) / 3))}`)).toBeNull();
  });
});

// A seller (and every role below the owner) reaches the photo routes; each route
// then checks who may correct the sale (lib/sale-permissions.ts). Before this,
// the staff guard answered 403 forbidden_role to the people who take the photos.
describe("photo routes for store roles", () => {
  it("lets the store roles through to the sale photo routes", () => {
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/sales/poss_1/store-frame-photo")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/sales/poss_1/wearing-photo")).toBe(true);
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/sales/poss_1/wearing-photo")).toBe(true);
    expect(isAllowedForRestrictedRole("DELETE", "/admin/pos/sales/poss_1/wearing-photo")).toBe(true);
  });
  it("keeps everything else around them closed", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/sales/poss_1/store-frame-photo")).toBe(false);
    expect(isAllowedForRestrictedRole("DELETE", "/admin/pos/sales/poss_1/store-frame-photo")).toBe(false);
    expect(isAllowedForRestrictedRole("DELETE", "/admin/pos/sales/poss_1")).toBe(false);
  });
});
