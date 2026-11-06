import {
  cleanPayrollPatch,
  isValidItin,
  isValidRouting,
  isValidSsn,
  masked,
  payrollAuditDetail,
  payrollIncomplete,
  viewPayroll,
} from "../src/lib/staff-payroll";
import { canStoreSecrets, decryptSecret, encryptSecret, fingerprint, generateSecretKey, sameFingerprint } from "../src/lib/secret-box";

/** Clave de prueba: 32 bytes, nunca una real. */
const ENV = { PAYROLL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv;

describe("tax ids and bank details the store accepts", () => {
  it("takes real-shaped SSNs and rejects the impossible ones", () => {
    for (const ok of ["123-45-6789", "001 01 0001", "772029400"]) expect(isValidSsn(ok)).toBe(true);
    for (const bad of ["000-45-6789", "666-45-6789", "900-45-6789", "123-00-6789", "123-45-0000", "12345678", "abcdefghi"]) {
      expect(isValidSsn(bad)).toBe(false);
    }
  });

  it("takes ITINs in the IRS group ranges", () => {
    expect(isValidItin("912-70-1234")).toBe(true);
    expect(isValidItin("912-50-1234")).toBe(true);
    expect(isValidItin("912-69-1234")).toBe(false); // 66-69 no se asigna
    expect(isValidItin("812-70-1234")).toBe(false); // no empieza por 9
  });

  it("checks the routing number's ABA check digit", () => {
    for (const ok of ["021000021", "011401533", "121000248"]) expect(isValidRouting(ok)).toBe(true);
    for (const bad of ["021000022", "12345678", "000000001"]) expect(isValidRouting(bad)).toBe(false);
  });
});

describe("what the form sends and what gets stored", () => {
  it("keeps only digits and refuses a mistyped number", () => {
    const r = cleanPayrollPatch({ tax_id_kind: "ssn", tax_id: "123-45-6789", routing_number: "021000021", account_number: "000123456789" });
    expect("patch" in r && r.patch).toMatchObject({ tax_id: "123456789", routing_number: "021000021", account_number: "000123456789" });
    expect(cleanPayrollPatch({ tax_id_kind: "ssn", tax_id: "000-45-6789" })).toMatchObject({ reason: "bad_tax_id" });
    expect(cleanPayrollPatch({ routing_number: "021000022" })).toMatchObject({ reason: "bad_routing" });
    expect(cleanPayrollPatch({ account_number: "12" })).toMatchObject({ reason: "bad_account_number" });
    expect(cleanPayrollPatch({ pay_method: "bitcoin" })).toMatchObject({ reason: "bad_pay_method" });
  });

  it("ignores the mask the panel shows, so re-saving a form does not wipe the data", () => {
    const r = cleanPayrollPatch({ tax_id: "•••• 6789", routing_number: "•••• 0021", bank_name: "Chase" });
    expect("patch" in r && r.patch).toEqual({ bank_name: "Chase" });
  });

  it("an empty string erases, an absent field leaves it alone", () => {
    const r = cleanPayrollPatch({ account_number: "" });
    expect("patch" in r && r.patch).toEqual({ account_number: null });
    expect(cleanPayrollPatch({})).toEqual({ patch: {} });
  });
});

describe("nothing usable leaves the server", () => {
  it("the view carries only the last four digits", () => {
    const view = viewPayroll(
      { pay_method: "direct_deposit", tax_id_kind: "ssn", tax_id_last4: "6789", routing_last4: "0021", account_last4: "6789", bank_name: "Chase" },
      true
    );
    expect(view.tax_id_masked).toBe("•••• 6789");
    expect(JSON.stringify(view)).not.toContain("123456789");
    expect(Object.keys(view)).not.toContain("tax_id");
    expect(masked(null)).toBeNull();
  });

  it("the audit entry records what changed, never the number", () => {
    const detail = payrollAuditDetail({ tax_id: "123456789", account_number: "000123456789", bank_name: "Chase" });
    expect(detail).toMatchObject({ tax_id_last4: "6789", account_last4: "6789", bank_name: "Chase" });
    expect(JSON.stringify(detail)).not.toContain("123456789");
  });

  it("flags a direct deposit with no account, before payday", () => {
    const base = viewPayroll({ pay_method: "direct_deposit" }, true);
    expect(payrollIncomplete(base)).toBe(true);
    expect(payrollIncomplete(viewPayroll({ pay_method: "direct_deposit", routing_last4: "0021", account_last4: "6789" }, true))).toBe(false);
    expect(payrollIncomplete(viewPayroll({ pay_method: "cash" }, true))).toBe(false);
  });
});

describe("encryption at rest", () => {
  it("round-trips and never stores the value in clear", () => {
    const enc = encryptSecret("123456789", ENV);
    expect(enc).not.toContain("123456789");
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc, ENV)).toBe("123456789");
  });

  it("uses a fresh IV, so the same number never looks the same twice", () => {
    expect(encryptSecret("123456789", ENV)).not.toBe(encryptSecret("123456789", ENV));
  });

  it("refuses a tampered value instead of returning garbage", () => {
    const enc = encryptSecret("123456789", ENV);
    const parts = enc.split(".");
    const flipped = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from("otro valor").toString("base64url")}`;
    expect(decryptSecret(flipped, ENV)).toBeNull();
    expect(decryptSecret(enc, { PAYROLL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") })).toBeNull();
  });

  it("without a key nothing is stored: encrypting throws and decrypting is null", () => {
    expect(canStoreSecrets({})).toBe(false);
    expect(() => encryptSecret("123456789", {})).toThrow("payroll_key_missing");
    expect(decryptSecret(encryptSecret("123456789", ENV), {})).toBeNull();
  });

  it("compares two numbers without decrypting them", () => {
    expect(sameFingerprint(fingerprint("123456789", ENV), fingerprint("123456789", ENV))).toBe(true);
    expect(sameFingerprint(fingerprint("123456789", ENV), fingerprint("987654321", ENV))).toBe(false);
  });

  it("generates a key of the right size for the setup guide", () => {
    expect(Buffer.from(generateSecretKey(), "base64")).toHaveLength(32);
    expect(canStoreSecrets({ PAYROLL_ENCRYPTION_KEY: generateSecretKey() })).toBe(true);
  });
});
