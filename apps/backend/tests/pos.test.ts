import {
  canSellAt,
  cleanCustomer,
  cleanLines,
  cleanPayments,
  methodCodeFor,
  needsPrescription,
  saleNumber,
  sellableStores,
} from "../src/lib/pos";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("saleNumber", () => {
  it("is the store code and a six-digit sequence", () => {
    expect(saleNumber("Op2", 147)).toBe("Op2-000147");
    expect(saleNumber("Op12", 1234567)).toBe("Op12-1234567");
  });
});

describe("canSellAt / sellableStores", () => {
  const stores = [
    { id: "est_1", is_active: true },
    { id: "est_2", is_active: true },
    { id: "est_3", is_active: false },
  ];

  it("admins sell anywhere active", () => {
    const admin = { is_admin: true, role: "superadmin", establishment_ids: null };
    expect(sellableStores(admin, stores).map((s) => s.id)).toEqual(["est_1", "est_2"]);
  });

  it("a seller only in their stores", () => {
    const seller = { is_admin: false, role: "seller", establishment_ids: ["est_2"] };
    expect(canSellAt(seller, "est_1")).toBe(false);
    expect(sellableStores(seller, stores).map((s) => s.id)).toEqual(["est_2"]);
  });

  it("an inactive user nowhere", () => {
    expect(canSellAt({ is_admin: false, role: null, establishment_ids: null }, "est_1")).toBe(false);
  });
});

describe("cleanCustomer", () => {
  const ok = {
    first_name: " Ana ",
    last_name: "Pérez",
    email: "Ana@Example.com",
    phone: "(832) 555-0101",
    birth_date: "1980-05-31",
  };

  it("cleans a valid customer; address is optional", () => {
    const r = cleanCustomer(ok, NOW);
    expect(r).toEqual({
      customer: { first_name: "Ana", last_name: "Pérez", email: "ana@example.com", phone: "(832) 555-0101", birth_date: "1980-05-31", address: null },
    });
  });

  it("requires name, email, phone and a real birth date", () => {
    expect(cleanCustomer({ ...ok, last_name: "" }, NOW)).toEqual({ reason: "customer_name" });
    expect(cleanCustomer({ ...ok, email: "ana@" }, NOW)).toEqual({ reason: "customer_email" });
    expect(cleanCustomer({ ...ok, phone: "12" }, NOW)).toEqual({ reason: "customer_phone" });
    expect(cleanCustomer({ ...ok, birth_date: "1980-02-30" }, NOW)).toEqual({ reason: "customer_birth_date" });
    expect(cleanCustomer({ ...ok, birth_date: "2027-01-01" }, NOW)).toEqual({ reason: "customer_birth_date" });
  });

  it("an address, once started, must be complete", () => {
    expect(cleanCustomer({ ...ok, address: { city: "Katy" } }, NOW)).toEqual({ reason: "customer_address" });
    const r = cleanCustomer({ ...ok, address: { address_1: "1 Main St", city: "Katy", postal_code: "77494" } }, NOW);
    expect("customer" in r && r.customer.address).toEqual({
      address_1: "1 Main St", city: "Katy", province: null, postal_code: "77494", country_code: "us",
    });
  });
});

describe("cleanLines", () => {
  it("accepts a catalog frame and a customer's own frame", () => {
    const r = cleanLines([
      { kind: "frame", variant_id: "variant_1", selection: { design_code: "frame-only" } },
      { kind: "own_frame", description: "Ray-Ban negro", photo: "data:image/jpeg;base64,AAAA", selection: { design_code: "sv", material_code: "cr39" } },
    ]);
    expect("lines" in r && r.lines.map((l) => [l.kind, l.variant_id, l.photo !== null])).toEqual([
      ["frame", "variant_1", false],
      ["own_frame", null, true],
    ]);
    expect("lines" in r && needsPrescription(r.lines)).toBe(true);
  });

  it("refuses an empty sale, a frame without variant and an own frame without lenses", () => {
    expect(cleanLines([])).toEqual({ reason: "no_lines" });
    expect(cleanLines([{ kind: "frame", selection: { design_code: "sv" } }])).toEqual({ reason: "bad_line" });
    expect(cleanLines([{ kind: "own_frame", selection: { design_code: "frame-only" } }])).toEqual({ reason: "own_frame_needs_lenses" });
    expect(cleanLines([{ kind: "frame", variant_id: "v", selection: { design_code: "sv; drop" } }])).toEqual({ reason: "bad_line" });
  });

  it("a bare frame needs no prescription", () => {
    const r = cleanLines([{ kind: "frame", variant_id: "v", selection: { design_code: "frame-only" } }]);
    expect("lines" in r && needsPrescription(r.lines)).toBe(false);
  });
});

describe("cleanPayments", () => {
  const methods = [
    { code: "cash", is_active: true, receivable: false },
    { code: "insurance", is_active: true, receivable: true },
    { code: "zelle", is_active: false, receivable: false },
  ];

  it("a split payment that covers the total exactly", () => {
    const r = cleanPayments([{ method_code: "cash", amount: 50.1 }, { method_code: "insurance", amount: "99.90", reference: "CLM-1" }], 15000, methods);
    expect(r).toEqual({
      payments: [
        { method_code: "cash", amount_cents: 5010, reference: null },
        { method_code: "insurance", amount_cents: 9990, reference: "CLM-1" },
      ],
    });
  });

  it("no partial payment, no unknown or inactive method", () => {
    expect(cleanPayments([{ method_code: "cash", amount: 100 }], 15000, methods)).toEqual({ reason: "payments_mismatch" });
    expect(cleanPayments([{ method_code: "zelle", amount: 150 }], 15000, methods)).toEqual({ reason: "bad_method" });
    expect(cleanPayments([{ method_code: "cash", amount: -1 }], 15000, methods)).toEqual({ reason: "bad_payment" });
    expect(cleanPayments([], 15000, methods)).toEqual({ reason: "no_payments" });
  });
});

describe("methodCodeFor", () => {
  it("slugs the label and never reuses a code", () => {
    expect(methodCodeFor("Cheque bancario", [])).toBe("cheque-bancario");
    expect(methodCodeFor("Crédito", ["credito"])).toBe("credito-2");
    expect(methodCodeFor("!!!", [])).toBe("method");
  });
});
