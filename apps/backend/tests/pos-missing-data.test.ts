/**
 * A sale recorded with patient data missing (owner, 17-nov-2026): the lenient
 * customer check, what is recorded as missing, and a sale with no deposit.
 */
import { cleanCustomer, cleanPayments, missingCustomerData, saleMissing } from "../src/lib/pos";

const now = new Date("2026-11-17T15:00:00Z");
const lenient = (c: Record<string, unknown>) => cleanCustomer(c as never, now, "America/Chicago", { lenient: true });

describe("lenient patient data at the till", () => {
  it("records a sale with only the first name or only the phone", () => {
    expect(lenient({ first_name: "Rosa" })).toMatchObject({ customer: { first_name: "Rosa", last_name: "", phone: "" } });
    expect(lenient({ phone: "(832) 555-0101" })).toMatchObject({ customer: { first_name: "", phone: "(832) 555-0101" } });
  });

  it("still needs at least the name or the phone", () => {
    expect(lenient({ email: "a@b.co" })).toEqual({ reason: "customer_identity" });
  });

  it("still refuses what is typed wrong", () => {
    expect(lenient({ first_name: "Rosa", phone: "12" })).toEqual({ reason: "customer_phone" });
    expect(lenient({ first_name: "R0sa!" })).toEqual({ reason: "customer_name" });
    expect(lenient({ first_name: "Rosa", email: "nope" })).toEqual({ reason: "customer_email" });
    expect(lenient({ first_name: "Rosa", birth_date: "2026-01-01" })).toEqual({ reason: "customer_birth_date" });
  });

  it("is strict when not asked to be lenient (web checkout and older callers)", () => {
    expect(cleanCustomer({ first_name: "Rosa" } as never, now)).toEqual({ reason: "customer_name" });
  });

  it("knows what is missing", () => {
    expect(missingCustomerData({ first_name: "Rosa", last_name: "", phone: "", address: null }, "ship")).toEqual(["last_name", "phone", "address"]);
    expect(missingCustomerData({ first_name: "Rosa", last_name: "Paz", phone: "8325550101", address: null }, "pickup")).toEqual([]);
  });

  it("adds the prescription and the deposit from the sale itself", () => {
    expect(saleMissing(["phone"], { rx_pending: true, paid: 0, insurance: 0, total: 200 })).toEqual(["phone", "prescription", "deposit"]);
    expect(saleMissing(null, { rx_pending: false, paid: 50, insurance: 0, total: 200 })).toEqual([]);
    expect(saleMissing(["bogus", "address"], { total: 0 })).toEqual(["address"]);
    expect(saleMissing(null, { total: 200, paid: 0, status: "voided" })).toEqual([]);
  });

  it("allows a sale with no deposit only when asked", () => {
    const methods = [{ code: "cash", kind: "cash", is_active: true, establishment_ids: null }] as never;
    expect(cleanPayments([], 20000, methods, { establishmentId: "est_1" })).toEqual({ reason: "no_payments" });
    expect(cleanPayments([], 20000, methods, { establishmentId: "est_1", allowNone: true })).toMatchObject({ paid_cents: 0, balance_cents: 20000 });
  });
});
