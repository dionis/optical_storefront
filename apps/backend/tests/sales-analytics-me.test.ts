/**
 * GET /admin/sales-analytics/me: a seller's figures are theirs alone. The
 * store's sales of the day (`store_today`) never leave for a seller (the
 * owner's rule: no general status, not even of their own store).
 */
import { GET } from "../src/api/admin/sales-analytics/me/route";
import { salesSummary } from "../src/lib/sales-analytics";
import { getStaffScope } from "../src/lib/staff-scope";

jest.mock("../src/lib/alerts", () => ({ localParts: () => ({ date: "2026-10-21", weekday: 3 }) }));
jest.mock("../src/lib/ready-orders", () => ({ readyToHand: jest.fn(async () => []) }));
jest.mock("../src/lib/pos-data", () => ({
  PosError: class PosError extends Error {
    constructor(public reason: string, public status = 422) {
      super(reason);
    }
  },
  listSales: jest.fn(async () => []),
  listTerminals: jest.fn(async () => [{ id: "t1", code: "T1", name: "Till" }]),
}));
jest.mock("../src/lib/establishments", () => ({ listEstablishments: jest.fn(async () => [{ id: "est_1", code: "A", name: "Store A", is_active: true }]) }));
jest.mock("../src/lib/cash", () => ({ openSessionFor: jest.fn(async () => null) }));
jest.mock("../src/lib/seller-link", () => ({ sellerOfUser: jest.fn(async () => null) }));
jest.mock("../src/lib/sales-analytics", () => ({
  salesSummary: jest.fn(async () => ({ current: { total: 100, count: 1, avg_ticket: 100, tax: 0 }, previous: { total: 0, count: 0, avg_ticket: 0, tax: 0 }, balance_due: 0, insurance_due: 0 })),
}));
jest.mock("../src/lib/staff-profile-data", () => ({ profileOf: jest.fn(async () => ({ commission_pct: 10, monthly_goal: null })) }));
jest.mock("../src/lib/staff-scope", () => ({ getStaffScope: jest.fn() }));
jest.mock("../src/lib/tenant", () => ({ tenant: () => ({ timezone: "America/New_York" }) }));

const base = { user_id: "u_me", is_admin: false, is_owner: false, establishment_ids: ["est_1"], privileges: [], seller_code: "V1", can_void: false, discount_limit_pct: null, legacy: false, seller: { establishment_id: "est_1", terminal_id: "t1" } };
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const req = { auth_context: { actor_id: "u_me" }, scope: { resolve: () => logger }, query: {}, method: "GET", url: "/admin/sales-analytics/me" } as never;
const res = () => {
  const r: { status: jest.Mock; json: jest.Mock; body?: unknown } = { status: jest.fn(), json: jest.fn() };
  r.status.mockReturnValue(r);
  r.json.mockImplementation((b: unknown) => { r.body = b; return r; });
  return r;
};

beforeEach(() => jest.clearAllMocks());

describe("GET /admin/sales-analytics/me", () => {
  it("a seller gets their own figures and workplace, never the store's day", async () => {
    (getStaffScope as jest.Mock).mockResolvedValue({ ...base, role: "seller" });
    const r = res();
    await GET(req, r as never);
    const body = r.body as Record<string, unknown>;
    expect(body.store_today).toBeNull();
    expect(body.workplace).toMatchObject({ store: { id: "est_1" }, terminal: { id: "t1" } });
    expect(body.commission).toEqual({ pct: 10, amount: 10 });
    // Every summary read is the seller's own.
    for (const call of (salesSummary as jest.Mock).mock.calls) expect(call[1].sellers).toEqual(["u_me"]);
  });

  it("a manager with a seller record still sees the store's day", async () => {
    (getStaffScope as jest.Mock).mockResolvedValue({ ...base, role: "manager" });
    const r = res();
    await GET(req, r as never);
    expect((r.body as Record<string, unknown>).store_today).toMatchObject({ total: 100, mine: 100 });
    expect((salesSummary as jest.Mock).mock.calls.some((c) => c[1].sellers === null && c[1].stores?.[0] === "est_1")).toBe(true);
  });
});
