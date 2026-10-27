import {
  acceptedAt,
  canSellAt,
  cleanDiscountPct,
  cleanMethodPatch,
  cleanRxMeta,
  discountLine,
  discountNeedsApproval,
  lowestFreeTray,
  nextTerminalCode,
  paymentFee,
  rxNumber,
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
    { code: "cash", is_active: true, receivable: false, kind: "cash", counts_as_cash: true },
    { code: "credit", is_active: true, receivable: false, kind: "credit", fee_pct: 3, fee_fixed_cents: 10, reference_fields: [{ key: "last4", required: false }] },
    { code: "zelle", is_active: true, receivable: false, kind: "zelle", reference_fields: [{ key: "confirmation", required: true }] },
    { code: "insurance", is_active: true, receivable: true, kind: "insurance", reference_fields: [{ key: "payer", required: true }] },
    { code: "check", is_active: false, receivable: false, kind: "other" },
    { code: "op2only", is_active: true, receivable: false, kind: "other", establishment_ids: ["est_2"] },
  ];
  const at = { establishmentId: "est_1" };

  it("a deposit leaves the rest as the customer's balance (HU-24)", () => {
    const r = cleanPayments([{ method_code: "cash", amount: 100, details: { tendered: 120 } }], 20250, methods, at);
    expect(r).toMatchObject({ paid_cents: 10000, insurance_cents: 0, balance_cents: 10250 });
    expect("payments" in r && r.payments[0]).toMatchObject({ counts_as_cash: true, details: { tendered_cents: 12000, change_cents: 2000 } });
  });

  it("split across methods, with the card fee and the insurer's part apart (HU-25, HU-113)", () => {
    const r = cleanPayments(
      [
        { method_code: "credit", amount: 50, details: { last4: "4242" } },
        { method_code: "insurance", amount: 100, details: { payer: "VSP" } },
      ],
      20000,
      methods,
      at
    );
    expect(r).toMatchObject({ paid_cents: 5000, insurance_cents: 10000, balance_cents: 5000 });
    expect("payments" in r && r.payments.map((p) => [p.method_code, p.fee_cents, p.insurance, p.reference])).toEqual([
      ["credit", 160, false, "4242"],
      ["insurance", 0, true, "VSP"],
    ]);
  });

  it("refuses overpaying, missing references, inactive methods and other stores' methods", () => {
    expect(cleanPayments([{ method_code: "cash", amount: 300 }], 20000, methods, at)).toEqual({ reason: "overpaid" });
    expect(cleanPayments([{ method_code: "zelle", amount: 10 }], 20000, methods, at)).toEqual({ reason: "missing_reference", method: "zelle" });
    expect(cleanPayments([{ method_code: "check", amount: 10 }], 20000, methods, at)).toEqual({ reason: "bad_method", method: "check" });
    expect(cleanPayments([{ method_code: "op2only", amount: 10 }], 20000, methods, at)).toEqual({ reason: "bad_method", method: "op2only" });
    expect(cleanPayments([{ method_code: "cash", amount: 10, details: { tendered: 5 } }], 20000, methods, at)).toEqual({ reason: "bad_tendered", method: "cash" });
    expect(cleanPayments([], 20000, methods, at)).toEqual({ reason: "no_payments" });
  });

  it("collecting a balance takes no insurer part and can require the full amount", () => {
    expect(cleanPayments([{ method_code: "insurance", amount: 10, details: { payer: "VSP" } }], 5000, methods, { ...at, allowInsurance: false })).toEqual({
      reason: "insurance_at_sale_only",
      method: "insurance",
    });
    expect(cleanPayments([{ method_code: "cash", amount: 10 }], 5000, methods, { ...at, requireFull: true })).toEqual({ reason: "payments_mismatch" });
  });

  it("a method is accepted where it is active and listed", () => {
    expect(acceptedAt(methods[5], "est_2")).toBe(true);
    expect(acceptedAt(methods[5], "est_1")).toBe(false);
    expect(paymentFee(methods[1], 0)).toBe(0);
  });
});

describe("cleanRxMeta", () => {
  const now = new Date("2026-10-27T12:00:00Z");

  it("an exact date, or an approximate one from months ago (HU-121)", () => {
    expect(cleanRxMeta({ rx_date: "2024-04-15", worn_source: "previous_rx" }, now)).toEqual({ rx_date: "2024-04-15", rx_date_approx: false, worn_source: "previous_rx" });
    expect(cleanRxMeta({ approx_months_ago: 36 }, now)).toEqual({ rx_date: "2023-10-01", rx_date_approx: true, worn_source: null });
  });

  it("refuses future dates and unknown sources", () => {
    expect(cleanRxMeta({ rx_date: "2027-01-01" }, now)).toEqual({ reason: "bad_rx_date" });
    expect(cleanRxMeta({ worn_source: "guess" }, now)).toEqual({ reason: "bad_worn_source" });
  });
});

describe("identifiers", () => {
  it("prescription numbers, tills and trays", () => {
    expect(rxNumber(2026, 812)).toBe("RX-2026-00812");
    expect(nextTerminalCode("Op2", [])).toBe("Op2-POS1");
    expect(nextTerminalCode("Op2", ["Op2-POS1", "Op2-POS3", "Op1-POS9"])).toBe("Op2-POS4");
    expect(lowestFreeTray([])).toBe(1);
    expect(lowestFreeTray([1, 2, 4])).toBe(3);
  });
});

describe("discounts", () => {
  it("validates the percentage", () => {
    expect(cleanDiscountPct(undefined)).toEqual({ pct: 0 });
    expect(cleanDiscountPct("10")).toEqual({ pct: 10 });
    expect(cleanDiscountPct(120)).toEqual({ reason: "bad_discount" });
  });

  it("applies to frame and lenses alike (document example: 10 % of $225 = $22.50)", () => {
    expect(discountLine({ frame: 36, lenses: 189 }, 10)).toEqual({ frame: 32.4, lenses: 170.1, total: 202.5 });
  });

  it("needs approval above the limit or under a minimum, never for admins", () => {
    expect(discountNeedsApproval({ isAdmin: false, pct: 10, limitPct: 10, belowMinimum: false })).toBe(false);
    expect(discountNeedsApproval({ isAdmin: false, pct: 12, limitPct: 10, belowMinimum: false })).toBe(true);
    expect(discountNeedsApproval({ isAdmin: false, pct: 5, limitPct: 10, belowMinimum: true })).toBe(true);
    expect(discountNeedsApproval({ isAdmin: true, pct: 40, limitPct: null, belowMinimum: true })).toBe(false);
  });
});

describe("cleanMethodPatch", () => {
  const opts = { builtin: false, creating: true, knownStores: ["est_1", "est_2"] };

  it("a new method with its fee, stores and reference data", () => {
    const r = cleanMethodPatch(
      { label: "Cheque", label_en: "Check", fee_pct: 1.5, fee_fixed: 0.3, establishment_ids: ["est_2"], reference_fields: [{ label: "Nº de cheque", label_en: "Check no.", required: true }] },
      opts
    );
    expect(r).toEqual({
      patch: {
        label: "Cheque",
        label_en: "Check",
        fee_pct: 1.5,
        fee_fixed_cents: 30,
        establishment_ids: ["est_2"],
        reference_fields: [{ key: "n_de_cheque", label: "Nº de cheque", label_en: "Check no.", required: true }],
      },
    });
  });

  it("a seeded method keeps its name and kind", () => {
    expect(cleanMethodPatch({ label: "Otro", fee_pct: 2 }, { ...opts, builtin: true, creating: false })).toEqual({ patch: { fee_pct: 2 } });
  });

  it("refuses unknown stores and bad fees", () => {
    expect(cleanMethodPatch({ label: "X", establishment_ids: ["est_9"] }, opts)).toEqual({ reason: "bad_store" });
    expect(cleanMethodPatch({ label: "X", fee_pct: 50 }, opts)).toEqual({ reason: "bad_fee" });
    expect(cleanMethodPatch({}, opts)).toEqual({ reason: "label_required" });
  });
});

describe("methodCodeFor", () => {
  it("slugs the label and never reuses a code", () => {
    expect(methodCodeFor("Cheque bancario", [])).toBe("cheque-bancario");
    expect(methodCodeFor("Crédito", ["credito"])).toBe("credito-2");
    expect(methodCodeFor("!!!", [])).toBe("method");
  });
});
