import { isValidEmail, isValidName, isValidPhone, isValidUsZip } from "../src/lib/field-rules";
import { cleanCustomer } from "../src/lib/pos";
import { cleanProfilePatch } from "../src/lib/staff-profile";

describe("contact fields the server accepts", () => {
  it("emails", () => {
    for (const ok of ["ana@correo.com", "a.b+c@sub.dominio.org"]) expect(isValidEmail(ok)).toBe(true);
    for (const bad of ["icaddddd", "a@b", "a@b.c", "a b@c.com", "a@@b.com", "a..b@c.com", "a@b..com", `${"a".repeat(250)}@b.com`]) expect(isValidEmail(bad)).toBe(false);
  });

  it("phones", () => {
    for (const ok of ["7863257738", "+1 (713) 555-0142", "786.325.7738"]) expect(isValidPhone(ok)).toBe(true);
    for (const bad of ["7863257738ddd", "abc", "123", "1234567890123456", "+1+2+3+4+5+6+7", "1".repeat(21)]) expect(isValidPhone(bad)).toBe(false);
  });

  it("names, in any alphabet, without digits or symbols", () => {
    for (const ok of ["María", "José Ángel", "O'Brien", "Jean-Luc", "Müller"]) expect(isValidName(ok)).toBe(true);
    for (const bad of ["Ana1", "<script>", "123", "-Ana", "a".repeat(81)]) expect(isValidName(bad)).toBe(false);
  });

  it("US ZIP codes", () => {
    for (const ok of ["77449", "77449-1234"]) expect(isValidUsZip(ok)).toBe(true);
    for (const bad of ["7744", "774499", "abcde", "77449-12"]) expect(isValidUsZip(bad)).toBe(false);
  });
});

describe("a till customer", () => {
  const ok = { first_name: "Ana", last_name: "Díaz", email: "ana@correo.com", phone: "7863257738", birth_date: "1990-05-01" };
  const reason = (o: object) => (cleanCustomer({ ...ok, ...o }) as { reason?: string }).reason;

  it("is accepted when right", () => {
    expect(reason({})).toBeUndefined();
  });

  it("refuses what the screen let through", () => {
    expect(reason({ phone: "7863257738ddd" })).toBe("customer_phone");
    expect(reason({ email: "icaddddd" })).toBe("customer_email");
    expect(reason({ first_name: "Ana1" })).toBe("customer_name");
  });

  it("refuses too long instead of cutting it", () => {
    expect(reason({ first_name: "a".repeat(81) })).toBe("customer_name");
    expect(reason({ phone: "1".repeat(21) })).toBe("customer_phone");
    expect(reason({ email: `${"a".repeat(260)}@correo.com` })).toBe("customer_email");
  });

  it("wants a real ZIP in an address", () => {
    expect(reason({ address: { address_1: "1 Main St", city: "Katy", postal_code: "abc" } })).toBe("customer_address");
    expect(reason({ address: { address_1: "1 Main St", city: "Katy", postal_code: "77449" } })).toBeUndefined();
  });
});

describe("a staff profile", () => {
  it("refuses a phone with letters", () => {
    expect(cleanProfilePatch({ phone_mobile: "7863257738ddd" }, "self")).toEqual({ reason: "bad_phone", field: "phone_mobile" });
    expect("patch" in cleanProfilePatch({ phone_mobile: "+1 (713) 555-0142" }, "self")).toBe(true);
  });
});
