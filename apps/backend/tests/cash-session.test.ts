/**
 * The store's cash register: the ledger rule, the signatures and the two
 * documents the owner receives (lib/cash.ts, lib/cash-documents.ts,
 * lib/email/cash-emails.ts). Pure pieces only — the routes and the database
 * writes are exercised against a real backend.
 */
import { cleanSignature, expectedCash, initialsOf, ledgerTotals, type CashSessionView } from "../src/lib/cash";
import { cashDocumentOf } from "../src/lib/cash-documents";
import { renderCashEmail } from "../src/lib/email/cash-emails";

// Dates in the documents follow the tenant's timezone (America/Chicago by default, lib/tenant.ts).
process.env.GSHEET_TIMEZONE = "America/Chicago";

const ana = { id: "u1", name: "Ana García", code: "ANA" };
const luis = { id: "u2", name: "Luis Pérez", code: "LP" };
const owner = { id: "u0", name: "Dionis Owner", code: null };

let seq = 0;
const line = (over: Partial<CashSessionView["movements"][number]>): CashSessionView["movements"][number] => ({
  id: `m${++seq}`,
  session_id: "cash_1",
  kind: "in",
  amount: 1,
  amount_cents: 100,
  category: "sale_payment",
  auto: true,
  note: null,
  created_by: "u1",
  by: ana,
  created_at: "2026-11-01T15:00:00.000Z",
  sale_id: null,
  payment_id: null,
  terminal_id: "t1",
  terminal_code: "Op1-POS1",
  ...over,
});

const session = (over: Partial<CashSessionView> = {}): CashSessionView => ({
  id: "cash_1",
  establishment_id: "est_1",
  terminal_id: null,
  status: "closed",
  opened_by: "u1",
  opened_by_person: ana,
  opened_at: "2026-11-01T14:00:00.000Z",
  opened_signature: "AG",
  opening_note: "auto",
  opening: 50,
  closed_at: "2026-11-02T00:30:00.000Z",
  closed_by: "u2",
  closed_by_person: luis,
  closed_signature: "LP",
  expected: 257,
  counted: 252,
  diff: -5,
  note: "faltan 5",
  approval_signature: null,
  approved_by: null,
  approved_by_person: null,
  approved_at: null,
  cash_in_sales: 230,
  cash_payments_count: 3,
  refunds: 20,
  manual_in: 0,
  manual_out: 23,
  movements: [
    line({ category: "opening_float", amount_cents: 5000, amount: 50, created_at: "2026-11-01T14:00:00.000Z", terminal_id: null, terminal_code: null }),
    line({ amount_cents: 10000, amount: 100, note: "Op1-000010", sale_id: "poss_10", payment_id: "pay_10" }),
    line({ amount_cents: 12000, amount: 120, note: "Op1-000011", sale_id: "poss_11", payment_id: "pay_11", created_by: "u2", by: luis, terminal_id: "t2", terminal_code: "Op1-POS2", created_at: "2026-11-01T16:00:00.000Z" }),
    line({ amount_cents: 3000, amount: 30, note: "Op1-000012", sale_id: "poss_12", payment_id: "pay_12", created_at: "2026-11-01T17:00:00.000Z" }),
    line({ kind: "out", category: "sale_refund", amount_cents: 2000, amount: 20, note: "Op1-000010", sale_id: "poss_10", payment_id: "pay_13", created_at: "2026-11-01T18:00:00.000Z" }),
    line({ kind: "out", category: "expense", auto: false, amount_cents: 2300, amount: 23, note: "papel", created_at: "2026-11-01T19:00:00.000Z" }),
  ],
  ...over,
});

const store = { id: "est_1", code: "Op1", name: "Tienda Norte", address: "1 Main St", phone: null, color: "#2563EB" };

describe("the ledger rule", () => {
  it("expected = opening + Σ in − Σ out, with the opening float line mirrored, not re-added", () => {
    const s = session();
    expect(expectedCash(5000, s.movements.map((m) => ({ kind: m.kind, amount: m.amount_cents, category: m.category })))).toBe(5000 + 10000 + 12000 + 3000 - 2000 - 2300);
    expect(ledgerTotals(s.movements)).toEqual({ cash_payments: 25000, cash_payments_count: 3, refunds: 2000, manual_in: 0, manual_out: 2300 });
  });
});

describe("signatures", () => {
  it("initials are 2–4 letters, upper-cased", () => {
    expect(cleanSignature(" ag ")).toBe("AG");
    expect(cleanSignature("DMNR")).toBe("DMNR");
    expect(cleanSignature("A")).toBeNull();
    expect(cleanSignature("ABCDE")).toBeNull();
    expect(cleanSignature("A1")).toBeNull();
    expect(cleanSignature(null)).toBeNull();
  });

  it("derives the automatic signature from the name, then the email", () => {
    expect(initialsOf("Ana García")).toBe("AG");
    expect(initialsOf("Dionis M. Ramírez")).toBe("DMR");
    expect(initialsOf("Ana", "ana.g@store.com")).toBe("AA");
    expect(initialsOf(null, "lp@store.com")).toBe("LP");
    expect(initialsOf(null, null)).toBe("XX");
  });
});

describe("the closing document", () => {
  const doc = cashDocumentOf(session(), store, "close", new Date("2026-11-02T00:31:00.000Z"));

  it("carries the totals, cash by till and by person, the manual lines and every movement oldest first", () => {
    expect(doc.totals).toEqual({ opening_cents: 5000, cash_payments_count: 3, cash_payments_cents: 25000, refunds_count: 1, refunds_cents: 2000, manual_in_cents: 0, manual_out_cents: 2300, expected_cents: 25700, counted_cents: 25200, diff_cents: -500 });
    expect(doc.by_terminal).toEqual([
      { terminal_id: "t2", code: "Op1-POS2", count: 1, cents: 12000 },
      { terminal_id: "t1", code: "Op1-POS1", count: 3, cents: 11000 },
    ]);
    expect(doc.by_seller.map((r) => [r.person?.code, r.count, r.cents])).toEqual([["LP", 1, 12000], ["ANA", 3, 11000]]);
    expect(doc.manual).toEqual([{ kind: "out", category: "expense", count: 1, cents: 2300, notes: ["papel"] }]);
    expect(doc.movements.map((m) => m.category)).toEqual(["opening_float", "sale_payment", "sale_payment", "sale_payment", "sale_refund", "expense"]);
    expect(doc.session).toMatchObject({ opened_signature: "AG", closed_signature: "LP", status: "closed", diff_cents: -500 });
    expect(doc.store.color).toBe("#2563EB");
  });

  it("refuses nothing on an opening: the same shape with the float only", () => {
    const open = cashDocumentOf(session({ closed_at: null, status: "open", counted: null, diff: null, expected: 50, movements: [session().movements[0]] }), store, "open");
    expect(open.totals).toMatchObject({ opening_cents: 5000, cash_payments_count: 0, expected_cents: 5000, counted_cents: null, diff_cents: null });
    expect(open.movements).toHaveLength(1);
  });
});

describe("the owner's emails", () => {
  it("closing: subject with store, date and difference; HTML with the store band, both signatures and every line", () => {
    const pending = session({ status: "pending_approval" });
    const { subject, html, text } = renderCashEmail(cashDocumentOf(pending, store, "close"), "es");
    expect(subject).toContain("Cierre de caja · Op1 · 2026-11-01 · diferencia -$5.00");
    for (const v of ["Tienda Norte", "Luis Pérez (LP) · LP", "Ana García (ANA) · AG", "apertura automática", "$257.00", "$252.00", "−$5.00", "Op1-000011", "Op1-POS2", "papel", "pendiente de la autorización"]) expect(html).toContain(v);
    expect(html).toContain('bgcolor="#2563EB"');
    expect(text).toContain("Diferencia: −$5.00");
  });

  it("closing approved by the owner shows the approval line, in English too", () => {
    const approved = session({ approval_signature: "DO", approved_by: "u0", approved_by_person: owner, approved_at: "2026-11-02T13:00:00.000Z" });
    const { subject, html } = renderCashEmail(cashDocumentOf(approved, store, "close"), "en");
    expect(subject).toContain("Register closing · Op1 · 2026-11-01 · difference -$5.00");
    expect(html).toContain("Difference approved by Dionis Owner (DO)");
  });

  it("opening: subject with store and date, the float and who opened", () => {
    const open = session({ closed_at: null, status: "open", counted: null, diff: null, expected: 50, opening_note: null, movements: [session().movements[0]] });
    const { subject, html } = renderCashEmail(cashDocumentOf(open, store, "open"), "es");
    expect(subject).toContain("Apertura de caja · Op1 · 2026-11-01");
    expect(subject).not.toContain("diferencia");
    expect(html).toContain("abrió la caja de Op1 · Tienda Norte");
    expect(html).toContain("$50.00");
    expect(html).not.toContain("Contado");
  });
});
