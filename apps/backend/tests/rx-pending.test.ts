import { deriveOrderProgress } from "../src/lib/order-status";
import { lineHasLenses, waitingForRx } from "../src/lib/rx-pending";
import { cleanDetailsPatch } from "../src/lib/pos-sale-admin";

/**
 * «Graduación pendiente» (owner, 15-nov-2026): the patient pays the deposit,
 * goes to the exam and the prescription comes hours later.
 */
const lens = (design: string, prescription_id: string | null = null) => ({ metadata: { lens_config: { design_code: design }, prescription_id } });

describe("which lines wait for a prescription", () => {
  it("a line with lenses needs one; a frame alone does not", () => {
    expect(lineHasLenses({ lens_config: { design_code: "prog-high" } })).toBe(true);
    expect(lineHasLenses({ lens_config: { design_code: "frame-only" } })).toBe(false);
    expect(lineHasLenses({})).toBe(false);
    expect(lineHasLenses(null)).toBe(false);
  });

  it("a sale waits while any lens line has no prescription", () => {
    expect(waitingForRx([lens("prog-high")])).toBe(true);
    expect(waitingForRx([lens("prog-high", "rx_1")])).toBe(false);
    expect(waitingForRx([lens("frame-only")])).toBe(false);
    expect(waitingForRx([lens("sv", "rx_1"), lens("sv")])).toBe(true);
    expect(waitingForRx([])).toBe(false);
  });
});

describe("on the order board it waits instead of being «in the lab»", () => {
  const order = (metadata: Record<string, unknown>) => ({ payment_status: "captured", fulfillment_status: "not_fulfilled", status: "pending", metadata, items: [] }) as never;
  it("a paid till order is in the lab", () => {
    expect(deriveOrderProgress(order({})).stage).toBe("in_lab");
  });
  it("a paid till order whose prescription is pending is still «confirmed»", () => {
    expect(deriveOrderProgress(order({ rx_pending: true })).stage).toBe("confirmed");
  });
  it("once the prescription is in, it is in the lab", () => {
    expect(deriveOrderProgress(order({ rx_pending: false })).stage).toBe("in_lab");
  });
});

describe("adding the prescription from the sale", () => {
  it("takes the same prescription shape as a correction", () => {
    const rx = { od: { sph: -1.25, add: 2 }, os: { sph: -1, add: 2 } };
    expect(cleanDetailsPatch({ prescription: { rx: rx as never, rx_date: "2026-11-15" } })).toEqual({ patch: { prescription: { rx, rx_date: "2026-11-15" } } });
    expect(cleanDetailsPatch({ prescription: { rx: { od: { sph: -1 } } as never } })).toEqual({ reason: "prescription_required" });
  });
});
