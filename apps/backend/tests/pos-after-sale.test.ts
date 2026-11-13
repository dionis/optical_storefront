import { runAfterSale } from "../src/lib/pos-after-sale";
import { emitAlert } from "../src/lib/alerts-data";
import { emailReceipt } from "../src/lib/pos-documents";
import { getSale } from "../src/lib/pos-data";
import { POST } from "../src/api/admin/pos/sales/route";
import { createPosSale } from "../src/lib/pos-data";

jest.mock("../src/lib/alerts-data", () => ({ emitAlert: jest.fn() }));
jest.mock("../src/lib/pos-documents", () => ({ emailReceipt: jest.fn() }));
jest.mock("../src/lib/pos-data", () => ({
  PosError: class extends Error {},
  checkPrescriptions: jest.fn(),
  createPosSale: jest.fn(),
  getSale: jest.fn(),
  listPaymentMethods: jest.fn(async () => []),
  listSales: jest.fn(),
  listTerminals: jest.fn(async () => [{ id: "t1", is_active: true }]),
  quoteSale: jest.fn(async () => ({ total_cents: 1000, discount_pct: 0, below_minimum: false, lines: [] })),
  rxContexts: jest.fn(() => []),
  rxDesigns: jest.fn(() => []),
}));
jest.mock("../src/lib/pos-route", () => ({
  ownSalesOnly: jest.fn(),
  posHandler: (_req: unknown, _res: unknown, fn: () => Promise<void>) => fn(),
  posScope: jest.fn(async () => ({ user_id: "u1", seller_code: "S1", is_admin: true })),
  scopeStoreIds: jest.fn(),
  sellableStore: jest.fn(async () => ({ id: "s1", code: "S1", name: "Store" })),
}));
jest.mock("../src/lib/pos-settings", () => ({
  discountLimitFor: jest.fn(() => null),
  getPosSettings: jest.fn(async () => ({ discount_limits: {}, optical_thresholds: {} })),
}));
jest.mock("../src/lib/pos", () => ({
  cleanCustomer: jest.fn(() => ({ customer: { email: "ana@example.com" } })),
  cleanDiscountPct: jest.fn(() => ({ pct: 0 })),
  cleanLines: jest.fn(() => ({ lines: [] })),
  cleanPayments: jest.fn(() => ({ payments: [] })),
  cleanRxMeta: jest.fn(),
  discountNeedsApproval: jest.fn(() => false),
  needsPrescription: jest.fn(() => false),
  sellerTillProblem: jest.fn(() => null),
}));

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const pg = { raw: jest.fn(async () => ({})) };
const container = {
  resolve: (key: string) => (key === "pg_connection" || key === "__pg_connection__" ? pg : logger),
} as never;
const row = { id: "sale1" };
const input = {
  sale: { id: "sale1", number: "S1-1", total: 10 },
  quote: { discount_pct: 0, below_minimum: false },
  store: { id: "s1", code: "S1", name: "Store" },
  sellerId: "u1",
  sellerCode: "S1",
  notifyEmail: true,
  receiptDetail: false,
  responseMs: 5,
};
const events = () => (emitAlert as jest.Mock).mock.calls.map((c) => c[1].event);

beforeEach(() => {
  jest.clearAllMocks();
  (getSale as jest.Mock).mockResolvedValue(row);
  (emailReceipt as jest.Mock).mockResolvedValue("a@b.co");
});

describe("runAfterSale", () => {
  it("sends the receipt and the sale alert, and logs the timing", async () => {
    await runAfterSale(container, input);
    expect(emailReceipt).toHaveBeenCalledWith(container, row, { detailed: false, actorId: "u1" });
    expect(events()).toEqual(["sale.created"]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("[pos] sale S1-1 timing: response 5ms"));
  });

  it("skips the receipt when the customer did not ask for it", async () => {
    await runAfterSale(container, { ...input, notifyEmail: false });
    expect(emailReceipt).not.toHaveBeenCalled();
    expect(events()).toEqual(["sale.created"]);
  });

  it("a failed receipt is logged and the alerts still go out", async () => {
    (emailReceipt as jest.Mock).mockRejectedValue(new Error("provider down"));
    await expect(runAfterSale(container, input)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("receipt not sent"));
    expect(events()).toEqual(["sale.created"]);
  });

  it("alerts a discount and a sale below the minimum", async () => {
    await runAfterSale(container, { ...input, quote: { discount_pct: 10, below_minimum: true } });
    expect(events()).toEqual(["sale.created", "discount.applied", "sale.below_min"]);
  });
});

describe("POST /admin/pos/sales", () => {
  const post = async (sale: Record<string, unknown>, body: Record<string, unknown> = {}) => {
    (createPosSale as jest.Mock).mockResolvedValue(sale);
    const res = { json: jest.fn() };
    await POST({ body: { terminal_id: "t1", notify_email: true, ...body }, scope: container } as never, res as never);
    return res;
  };
  const sale = { id: "sale1", number: "S1-1", total: 10 };

  it("answers without waiting for the receipt", async () => {
    (emailReceipt as jest.Mock).mockReturnValue(new Promise(() => {})); // a provider that never answers
    const res = await post(sale);
    expect(res.json).toHaveBeenCalledWith({ sale });
    await new Promise((resolve) => setImmediate(resolve));
    expect(emailReceipt).toHaveBeenCalled();
  });

  it("the detailed receipt needs exactly true", async () => {
    await post(sale, { receipt_detail: "true" });
    await new Promise((resolve) => setImmediate(resolve));
    expect((emailReceipt as jest.Mock).mock.calls[0][2].detailed).toBe(false);
  });

  it("a patient without email gets no receipt mail (the email is optional at the counter)", async () => {
    const { cleanCustomer } = jest.requireMock("../src/lib/pos") as { cleanCustomer: jest.Mock };
    cleanCustomer.mockReturnValueOnce({ customer: { email: "" } });
    await post(sale);
    await new Promise((resolve) => setImmediate(resolve));
    expect(emailReceipt).not.toHaveBeenCalled();
    expect(emitAlert).toHaveBeenCalled(); // the rest of the after-sale work still runs
  });

  it("a retried sale does not send anything again", async () => {
    await post({ ...sale, replayed: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(getSale).not.toHaveBeenCalled();
    expect(emitAlert).not.toHaveBeenCalled();
  });
});
