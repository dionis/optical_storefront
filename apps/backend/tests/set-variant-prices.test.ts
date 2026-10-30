const run = jest.fn().mockResolvedValue({});

jest.mock("@medusajs/medusa/core-flows", () => ({
  upsertVariantPricesWorkflow: () => ({ run }),
}));
jest.mock("../src/modules/store-pricing", () => ({ STORE_PRICING_MODULE: "storePricing" }));
jest.mock("../src/lib/audit", () => ({ recordAudit: jest.fn() }));

import { setVariantPrices } from "../src/lib/store-pricing-data";

const line = (id: string) => ({ variant_id: id, product_id: "prod_1", prices: [{ amount: 42, currency_code: "usd" }] });

describe("setVariantPrices", () => {
  beforeEach(() => run.mockClear());

  it("marks only the variants that already have a price set as existing, so the rest get one", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [{ variant_id: "v_linked" }] });
    const container = { resolve: () => ({ graph }) } as never;

    await setVariantPrices(container, [line("v_linked"), line("v_orphan")]);

    expect(graph.mock.calls[0][0].filters).toEqual({ variant_id: ["v_linked", "v_orphan"] });
    expect(run).toHaveBeenCalledWith({
      input: { variantPrices: [line("v_linked"), line("v_orphan")], previousVariantIds: ["v_linked"] },
    });
  });

  it("does nothing without updates", async () => {
    const graph = jest.fn();
    await setVariantPrices({ resolve: () => ({ graph }) } as never, []);
    expect(graph).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
