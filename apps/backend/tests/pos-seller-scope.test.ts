/**
 * The owner's rule for sellers: they see their own sales in full, the
 * colleagues' sales of their store only while those owe money (and only what
 * is needed to collect), and nothing else — not even the store's status.
 */
import { GET as listRoute } from "../src/api/admin/pos/sales/route";
import { GET as detailRoute } from "../src/api/admin/pos/sales/[id]/route";
import { POST as paymentsRoute } from "../src/api/admin/pos/sales/[id]/payments/route";
import { collectPayment, getSale, listSales } from "../src/lib/pos-data";
import { getStaffScope } from "../src/lib/staff-scope";
import { limitedSale, saleAccessFor, type SaleAccess } from "../src/lib/pos-route";
import type { SaleRow } from "../src/lib/pos-data";

jest.mock("../src/lib/pos-data", () => ({
  PosError: class PosError extends Error {
    constructor(public reason: string, public status = 422, public extra: Record<string, unknown> = {}) {
      super(reason);
    }
  },
  collectPayment: jest.fn(),
  getSale: jest.fn(),
  listClaims: jest.fn(async () => []),
  listPaymentMethods: jest.fn(async () => [{ code: "cash", kind: "cash", is_active: true, fee_pct: 0, fee_fixed_cents: 0, counts_as_cash: true, establishment_ids: null, reference_fields: [] }]),
  listSales: jest.fn(async () => []),
  listTerminals: jest.fn(async () => []),
}));
jest.mock("../src/lib/establishments", () => ({
  listEstablishments: jest.fn(async () => [
    { id: "est_1", code: "A", name: "Store A", is_active: true },
    { id: "est_2", code: "B", name: "Store B", is_active: true },
  ]),
}));
jest.mock("../src/lib/staff-scope", () => ({ getStaffScope: jest.fn() }));
jest.mock("../src/lib/staff-profile", () => ({ hasPrivilege: jest.fn(() => false) }));
jest.mock("../src/lib/pos-after-sale", () => ({ runAfterSale: jest.fn() }));
jest.mock("../src/lib/pos-settings", () => ({ discountLimitFor: jest.fn(), getPosSettings: jest.fn() }));

const SELLER = { user_id: "u_me", is_admin: false, is_owner: false, role: "seller", establishment_ids: ["est_1"] as string[] | null, privileges: [], seller_code: "V1", can_void: false, discount_limit_pct: null, legacy: false };
const MANAGER = { ...SELLER, user_id: "u_mgr", role: "manager", seller_code: "M1" };
const ADMIN = { ...SELLER, user_id: "u_adm", is_admin: true, role: "superadmin", establishment_ids: null };

const sale = (over: Partial<SaleRow> = {}): SaleRow => ({
  id: "poss_1",
  number: "A-000001",
  establishment_id: "est_1",
  terminal_id: "t1",
  seller_id: "u_other",
  seller_code: "V2",
  customer_id: "cus_1",
  order_id: "order_1",
  list: 200,
  discount: 20,
  discount_pct: 10,
  total: 180,
  paid: 80,
  insurance: 0,
  balance: 100,
  status: "completed",
  tray: "A-3",
  promised_on: "2026-10-20",
  delivery: "pickup",
  delivered_at: null,
  voided_at: null,
  void_reason: null,
  void_note: null,
  void_requested_at: null,
  created_at: "2026-10-10T12:00:00.000Z",
  payments: [{ method_code: "cash", amount: 80, kind: "deposit", reference: null, created_at: "2026-10-10T12:00:00.000Z" }],
  internal_note: null, edited_at: null, edited_by: null, deleted_at: null, deleted_by: null, delete_reason: null, previous_numbers: [],
  has_wearing_photo: false, wearing_photo_at: null,
  ...over,
});

// A knex-like `customer` table with one row.
const customers = [{ id: "cus_1", first_name: "Ana", last_name: "Pérez", email: "ana@x.co", phone: "+1 555 0100" }];
const pg = Object.assign(
  () => ({ whereIn: (_c: string, ids: string[]) => ({ select: async () => customers.filter((c) => ids.includes(c.id)) }) }),
  { raw: jest.fn() }
);
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const container = { resolve: (key: string) => (key === "__pg_connection__" || key === "pg_connection" ? pg : logger) };

function req(query: Record<string, string> = {}, params: Record<string, string> = {}, body: unknown = {}) {
  return { auth_context: { actor_id: "u_me" }, scope: container, query, params, body, method: "GET", url: "/admin/pos/sales" } as never;
}
function res() {
  const r: { status: jest.Mock; json: jest.Mock; body?: unknown; code?: number } = { status: jest.fn(), json: jest.fn() };
  r.status.mockImplementation((c: number) => { r.code = c; return r; });
  r.json.mockImplementation((b: unknown) => { r.body = b; return r; });
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getStaffScope as jest.Mock).mockResolvedValue(SELLER);
});

describe("saleAccessFor (the owner's rule)", () => {
  const access = (scope: typeof SELLER, s: SaleRow): SaleAccess => saleAccessFor(scope as never, s);

  it("a seller sees their own sales in full", () => {
    expect(access(SELLER, sale({ seller_id: "u_me", balance: 0 }))).toBe("full");
    expect(access(SELLER, sale({ seller_id: "u_me", status: "voided", balance: 0 }))).toBe("full");
  });

  it("a colleague's sale of their store only while it owes money, and reduced", () => {
    expect(access(SELLER, sale({ balance: 100 }))).toBe("limited");
    expect(access(SELLER, sale({ balance: 0 }))).toBeNull();
    expect(access(SELLER, sale({ balance: 100, status: "voided" }))).toBeNull();
    // An old sale with no seller is nobody's own.
    expect(access(SELLER, sale({ seller_id: null, balance: 0 }))).toBeNull();
  });

  it("never a sale of another store", () => {
    expect(access(SELLER, sale({ establishment_id: "est_2", balance: 100 }))).toBeNull();
    expect(access(SELLER, sale({ establishment_id: "est_2", seller_id: "u_me" }))).toBeNull();
  });

  it("the other roles see their stores' sales in full; admins everything", () => {
    expect(access(MANAGER, sale({ balance: 0 }))).toBe("full");
    expect(access(MANAGER, sale({ establishment_id: "est_2" }))).toBeNull();
    expect(access(ADMIN, sale({ establishment_id: "est_2", balance: 0 }))).toBe("full");
  });
});

describe("limitedSale", () => {
  it("keeps only what is needed to collect: no items, prescription, discount or economics", () => {
    const row = limitedSale(sale(), { name: "Ana Pérez", phone: "+1 555 0100" });
    expect(row).toEqual({
      id: "poss_1",
      number: "A-000001",
      establishment_id: "est_1",
      created_at: "2026-10-10T12:00:00.000Z",
      customer_name: "Ana Pérez",
      customer_phone: "+1 555 0100",
      seller_code: "V2",
      total: 180,
      paid: 80,
      balance: 100,
      promised_on: "2026-10-20",
      status: "completed",
      limited: true,
    });
    expect(Object.keys(row)).not.toContain("discount");
    expect(Object.keys(row)).not.toContain("customer_id");
    expect(Object.keys(row)).not.toContain("payments");
  });

  it("carries the payments only when a single sale is opened", () => {
    expect(limitedSale(sale(), null, true).payments).toHaveLength(1);
    expect(limitedSale(sale(), null).customer_name).toBeNull();
  });
});

describe("GET /admin/pos/sales for a seller", () => {
  it("lists their own sales plus the colleagues' sales that owe money, those reduced", async () => {
    (listSales as jest.Mock).mockResolvedValue([sale({ id: "poss_mine", seller_id: "u_me", balance: 0 }), sale({ id: "poss_other", balance: 100 })]);
    const r = res();
    await listRoute(req(), r as never);
    const filter = (listSales as jest.Mock).mock.calls[0][1];
    expect(filter).toMatchObject({ establishmentIds: ["est_1"], ownOrPendingFor: "u_me" });
    expect(filter.sellerId).toBeUndefined();
    const rows = (r.body as { sales: Array<Record<string, unknown>> }).sales;
    expect(rows[0]).toMatchObject({ id: "poss_mine", discount: 20, customer_name: "Ana Pérez", customer_phone: "+1 555 0100" });
    expect(rows[0].limited).toBeUndefined();
    expect(rows[1]).toMatchObject({ id: "poss_other", limited: true, balance: 100, customer_name: "Ana Pérez" });
    expect(rows[1].discount).toBeUndefined();
    expect(rows[1].payments).toBeUndefined();
  });

  it("ignores a seller filter from a seller, and looking a sale up never widens the rule", async () => {
    const r = res();
    await listRoute(req({ seller: "u_other", number: "A-000001" }), r as never);
    const filter = (listSales as jest.Mock).mock.calls[0][1];
    expect(filter.sellerId).toBeUndefined();
    expect(filter.ownOrPendingFor).toBe("u_me");
    expect(filter.number).toBe("A-000001");
  });

  it("?mine=1 lists only the caller's own sales; ?pending=1 only what owes money", async () => {
    await listRoute(req({ mine: "1" }), res() as never);
    expect((listSales as jest.Mock).mock.calls[0][1]).toMatchObject({ sellerId: "u_me" });
    expect((listSales as jest.Mock).mock.calls[0][1].ownOrPendingFor).toBeUndefined();
    await listRoute(req({ pending: "1" }), res() as never);
    expect((listSales as jest.Mock).mock.calls[1][1]).toMatchObject({ withBalance: true, ownOrPendingFor: "u_me" });
  });

  it("a manager keeps full rows of their stores, with the customer's contact when collecting", async () => {
    (getStaffScope as jest.Mock).mockResolvedValue(MANAGER);
    (listSales as jest.Mock).mockResolvedValue([sale({ balance: 100 })]);
    const r = res();
    await listRoute(req({ pending: "1", seller: "u_other" }), r as never);
    expect((listSales as jest.Mock).mock.calls[0][1]).toMatchObject({ establishmentIds: ["est_1"], sellerId: "u_other", withBalance: true });
    const [row] = (r.body as { sales: Array<Record<string, unknown>> }).sales;
    expect(row).toMatchObject({ discount: 20, customer_name: "Ana Pérez", payments: expect.any(Array) });
    expect(row.limited).toBeUndefined();
  });
});

describe("GET /admin/pos/sales/:id for a seller", () => {
  it("opens a colleague's sale that owes money as the collection view, with its payments", async () => {
    (getSale as jest.Mock).mockResolvedValue(sale({ balance: 100 }));
    const r = res();
    await detailRoute(req({}, { id: "poss_1" }), r as never);
    const body = r.body as { sale: Record<string, unknown>; insurance_claims: unknown[] };
    expect(body.sale).toMatchObject({ limited: true, customer_name: "Ana Pérez", balance: 100 });
    expect(body.sale.payments).toHaveLength(1);
    expect(body.sale.discount).toBeUndefined();
    expect(body.insurance_claims).toEqual([]);
  });

  it("refuses a colleague's sale with nothing due: 403 forbidden_sale", async () => {
    (getSale as jest.Mock).mockResolvedValue(sale({ balance: 0 }));
    const r = res();
    await detailRoute(req({}, { id: "poss_1" }), r as never);
    expect(r.code).toBe(403);
    expect(r.body).toMatchObject({ reason: "forbidden_sale" });
  });

  it("refuses a sale of another store: 403 forbidden_store", async () => {
    (getSale as jest.Mock).mockResolvedValue(sale({ establishment_id: "est_2", balance: 100 }));
    const r = res();
    await detailRoute(req({}, { id: "poss_1" }), r as never);
    expect(r.code).toBe(403);
    expect(r.body).toMatchObject({ reason: "forbidden_store" });
  });

  it("their own sale comes in full", async () => {
    (getSale as jest.Mock).mockResolvedValue(sale({ seller_id: "u_me", balance: 0 }));
    const r = res();
    await detailRoute(req({}, { id: "poss_1" }), r as never);
    expect((r.body as { sale: Record<string, unknown> }).sale).toMatchObject({ discount: 20, customer_id: "cus_1" });
  });
});

describe("POST /admin/pos/sales/:id/payments for a seller", () => {
  const body = { payments: [{ method_code: "cash", amount: 40 }] };

  it("collects a colleague's balance; the payment is theirs (received_by) and the answer is the collection view", async () => {
    (getSale as jest.Mock).mockResolvedValue(sale({ balance: 100 }));
    (collectPayment as jest.Mock).mockResolvedValue(sale({ balance: 60, paid: 120 }));
    const r = res();
    await paymentsRoute(req({}, { id: "poss_1" }, body), r as never);
    expect(collectPayment).toHaveBeenCalledWith(container, expect.objectContaining({ id: "poss_1" }), expect.objectContaining({ paid_cents: 4000 }), "u_me");
    expect((r.body as { sale: Record<string, unknown> }).sale).toMatchObject({ limited: true, balance: 60, paid: 120, customer_name: "Ana Pérez" });
  });

  it("never on a colleague's sale with nothing due (403 forbidden_sale, before any amount is checked)", async () => {
    (getSale as jest.Mock).mockResolvedValue(sale({ balance: 0 }));
    const r = res();
    await paymentsRoute(req({}, { id: "poss_1" }, body), r as never);
    expect(r.code).toBe(403);
    expect(r.body).toMatchObject({ reason: "forbidden_sale" });
    expect(collectPayment).not.toHaveBeenCalled();
  });

  it("their own sale answers in full", async () => {
    (getSale as jest.Mock).mockResolvedValue(sale({ seller_id: "u_me", balance: 100 }));
    (collectPayment as jest.Mock).mockResolvedValue(sale({ seller_id: "u_me", balance: 60, paid: 120 }));
    const r = res();
    await paymentsRoute(req({}, { id: "poss_1" }, body), r as never);
    expect((r.body as { sale: Record<string, unknown> }).sale).toMatchObject({ discount: 20, balance: 60 });
  });
});
