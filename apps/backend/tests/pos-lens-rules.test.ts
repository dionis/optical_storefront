/**
 * Lens × prescription compatibility is enforced on the server (audit of
 * 5-nov-2026): the browser's LensPicker and rxRules.js explain; these rules
 * are what a stale screen or a hand-made request cannot skip. Pure rules
 * first, then the quote path mapping them to PosError reasons — with the
 * data layer stubbed, as the rest of the POS tests.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { LensFinishError } from "../src/lib/lens-finish";
import { computeLensBreakdown, LensOptionError } from "../src/lib/lens-quote";
import {
  ADD_MISMATCH_TOLERANCE,
  arGroupServes,
  lensRxProblem,
  lensRxProblems,
  rxConfirmationProblem,
  storedVerifiedByUser,
  type LensRxDesign,
} from "../src/lib/pos-lens-rules";
import { checkPrescriptions, PosError, quoteSale, rxDesigns, type RxInput } from "../src/lib/pos-data";
import type { PosLine } from "../src/lib/pos";

jest.mock("../src/lib/lens-quote", () => {
  const actual = jest.requireActual("../src/lib/lens-quote");
  return { ...actual, computeLensBreakdown: jest.fn() };
});
jest.mock("../src/lib/store-pricing-data", () => ({
  openRules: jest.fn(async () => []),
  productPrices: jest.fn(async () => []),
}));
jest.mock("../src/lib/store-settings", () => ({
  resolveStoreSettings: jest.fn(async () => ({ frame_tax_rate: 0 })),
}));
jest.mock("../src/lib/frame-specs", () => ({
  loadProductMetadata: jest.fn(async () => new Map()),
  frameBrand: jest.fn(() => null),
  posFrameSpecs: jest.fn(() => ({})),
}));
jest.mock("../src/lib/store-assortment-data", () => ({
  listAssortmentRules: jest.fn(async () => []),
  effectiveAssortmentRules: jest.fn(async () => []),
}));

const breakdown = computeLensBreakdown as jest.MockedFunction<typeof computeLensBreakdown>;

const SV: LensRxDesign = { code: "sv", category: "sv", requires_add: false };
const BIFOCAL: LensRxDesign = { code: "bifocal", category: "bifocal", requires_add: true };
const PROG: LensRxDesign = { code: "prog-mid", category: "prog", requires_add: true };
const FRAME_ONLY: LensRxDesign = { code: "frame-only", category: null, requires_add: false };

const rx = (od: number | null, os: number | null) => ({ od: { sph: -1, add: od }, os: { sph: -1, add: os } });

// ── Pure rules ───────────────────────────────────────────────────────────────

describe("lensRxProblem: a design that needs an ADD", () => {
  it("accepts a bifocal or progressive with the same ADD in both eyes", () => {
    expect(lensRxProblem(BIFOCAL, rx(2, 2))).toBeNull();
    expect(lensRxProblem(PROG, rx(1.25, 1.25))).toBeNull();
  });

  it("rejects it when neither eye has an ADD (design_needs_add)", () => {
    expect(lensRxProblem(BIFOCAL, rx(null, null))).toEqual({
      reason: "design_needs_add",
      details: { design_code: "bifocal", category: "bifocal", eye: "od" },
    });
    expect(lensRxProblem(PROG, rx(0, 0))?.reason).toBe("design_needs_add");
  });

  it("rejects it when only one eye has an ADD, naming the empty eye (the client asks for both)", () => {
    expect(lensRxProblem(PROG, rx(2, null))).toMatchObject({ reason: "design_needs_add", details: { eye: "os" } });
    expect(lensRxProblem(PROG, rx(null, 2))).toMatchObject({ reason: "design_needs_add", details: { eye: "od" } });
  });

  it("rejects an ADD that differs between the eyes (the client mirrors it) with both values", () => {
    expect(lensRxProblem(PROG, rx(2, 2.25))).toEqual({
      reason: "rx_add_mismatch",
      details: { design_code: "prog-mid", category: "prog", od_add: 2, os_add: 2.25 },
    });
  });

  it("tolerates only float noise between the two ADDs", () => {
    expect(lensRxProblem(PROG, rx(2, 2 + ADD_MISMATCH_TOLERANCE / 2))).toBeNull();
    expect(lensRxProblem(PROG, rx(2, 2 + ADD_MISMATCH_TOLERANCE * 2))?.reason).toBe("rx_add_mismatch");
  });

  it("reads an ADD sent as text or as an unreadable value like the till's num()", () => {
    expect(lensRxProblem(PROG, { od: { add: "2.00" as never }, os: { add: "2.00" as never } })).toBeNull();
    expect(lensRxProblem(PROG, { od: { add: "" as never }, os: { add: 2 } })?.reason).toBe("design_needs_add");
    expect(lensRxProblem(PROG, { od: { add: "abc" as never }, os: { add: 2 } })?.reason).toBe("design_needs_add");
  });
});

describe("lensRxProblem: single vision", () => {
  it("accepts a prescription without an ADD, or with an explicit 0", () => {
    expect(lensRxProblem(SV, rx(null, null))).toBeNull();
    expect(lensRxProblem(SV, rx(0, 0))).toBeNull();
    expect(lensRxProblem(SV, { od: { sph: -1 }, os: { sph: -1 } } as never)).toBeNull();
  });

  it("rejects an ADD in either eye (design_no_add), naming the eye", () => {
    expect(lensRxProblem(SV, rx(2, 2))).toEqual({
      reason: "design_no_add",
      details: { design_code: "sv", category: "sv", eye: "od" },
    });
    expect(lensRxProblem(SV, rx(null, 1.5))).toMatchObject({ reason: "design_no_add", details: { eye: "os" } });
  });

  it("never minds a bare frame: a customer may buy the frame only with a prescription in hand", () => {
    expect(lensRxProblem(FRAME_ONLY, rx(2, 2))).toBeNull();
    expect(lensRxProblem(FRAME_ONLY, rx(null, null))).toBeNull();
  });

  it("leaves a design of another category without the ADD flag alone (owner-edited rows)", () => {
    expect(lensRxProblem({ code: "bifocal", category: "bifocal", requires_add: false }, rx(null, null))).toBeNull();
    expect(lensRxProblem({ code: "bifocal", category: "bifocal", requires_add: false }, rx(2, 2))).toBeNull();
  });
});

describe("lensRxProblems", () => {
  it("returns the first problem across the sale's designs, null when all fit", () => {
    expect(lensRxProblems([FRAME_ONLY, SV], rx(null, null))).toBeNull();
    expect(lensRxProblems([FRAME_ONLY, PROG], rx(null, null))?.reason).toBe("design_needs_add");
    expect(lensRxProblems([], rx(2, 1))).toBeNull();
  });
});

describe("rxConfirmationProblem / storedVerifiedByUser (OCR)", () => {
  it("requires a person's confirmation for a prescription read from a photo", () => {
    expect(rxConfirmationProblem({ source: "ocr", verified_by_user: true })).toBeNull();
    expect(rxConfirmationProblem({ source: "ocr", verified_by_user: false })).toBe("rx_unconfirmed");
    expect(rxConfirmationProblem({ source: "ocr" })).toBe("rx_unconfirmed");
    expect(rxConfirmationProblem({ source: "ocr", verified_by_user: "true" })).toBe("rx_unconfirmed");
  });

  it("a typed prescription is confirmed by being typed", () => {
    expect(rxConfirmationProblem({ source: "manual" })).toBeNull();
    expect(rxConfirmationProblem({ source: "manual", verified_by_user: false })).toBeNull();
    expect(rxConfirmationProblem(null)).toBeNull();
  });

  it("stores what the client sent instead of an unconditional true", () => {
    expect(storedVerifiedByUser({ source: "ocr", verified_by_user: true })).toBe(true);
    expect(storedVerifiedByUser({ source: "ocr" })).toBe(false);
    expect(storedVerifiedByUser({ source: "manual" })).toBe(true);
    expect(storedVerifiedByUser({ source: "manual", verified_by_user: false })).toBe(false);
  });
});

describe("arGroupServes", () => {
  it("maps the three groups onto the design categories", () => {
    expect(arGroupServes("sv", "sv")).toBe(true);
    expect(arGroupServes("sv", "prog")).toBe(false);
    expect(arGroupServes("bifprog", "bifocal")).toBe(true);
    expect(arGroupServes("bifprog", "prog")).toBe(true);
    expect(arGroupServes("bifprog", "sv")).toBe(false);
    expect(arGroupServes("all", "sv")).toBe(true);
    expect(arGroupServes("all", "prog")).toBe(true);
    expect(arGroupServes(null, "sv")).toBe(false);
    expect(arGroupServes("other", "sv")).toBe(false);
  });
});

// ── Quote path: PosError reasons ─────────────────────────────────────────────

function container(services: Record<string, unknown> = {}) {
  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.PG_CONNECTION]: {},
    [ContainerRegistrationKeys.QUERY]: { graph: jest.fn(async () => ({ data: [] })) },
    [ContainerRegistrationKeys.LOGGER]: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...services,
  };
  return { resolve: (key: string) => registry[key] } as never;
}

/** Lenses for a frame the customer brought: no catalog variant, no price lookup. */
const ownLine = (selection: Partial<PosLine["selection"]> = {}): PosLine => ({
  kind: "own_frame",
  variant_id: null,
  selection: { design_code: "sv", material_code: "cr39", photo_code: null, ar_code: null, finish: null, ...selection },
  description: "Ray-Ban",
  photo: null,
});

const fullBreakdown = (over: Partial<Awaited<ReturnType<typeof computeLensBreakdown>>> = {}) => ({
  lens_base_cents: 6000,
  photo_cents: 0,
  ar_cents: 0,
  total_cents: 6000,
  category: "sv",
  requires_add: false,
  finish: "stock" as const,
  cost_cents: null,
  ...over,
});

describe("quoteSale maps the lens option errors to PosError reasons", () => {
  beforeEach(() => breakdown.mockReset());

  it("photo_unavailable, 422, naming the option and the design", async () => {
    breakdown.mockRejectedValueOnce(new LensOptionError("photo_unavailable", "photo-brown", "sv", "sv"));
    const attempt = quoteSale(container(), "est_1", [ownLine({ photo_code: "photo-brown" })]);
    await expect(attempt).rejects.toBeInstanceOf(PosError);
    await expect(attempt).rejects.toMatchObject({
      reason: "photo_unavailable",
      status: 422,
      extra: { code: "photo-brown", design_code: "sv", category: "sv" },
    });
  });

  it("ar_unavailable, 422", async () => {
    breakdown.mockRejectedValueOnce(new LensOptionError("ar_unavailable", "adequate", "sv", "sv"));
    await expect(quoteSale(container(), "est_1", [ownLine({ ar_code: "adequate" })])).rejects.toMatchObject({
      reason: "ar_unavailable",
      status: 422,
      extra: { code: "adequate", design_code: "sv", category: "sv" },
    });
  });

  it("keeps finish_unavailable as before and bad_lens for anything else", async () => {
    breakdown.mockRejectedValueOnce(new LensFinishError("sv", "poly", "digital"));
    await expect(quoteSale(container(), "est_1", [ownLine({ material_code: "poly", finish: "digital" })])).rejects.toMatchObject({
      reason: "finish_unavailable",
      extra: { design_code: "sv", material_code: "poly", finish: "digital" },
    });
    breakdown.mockRejectedValueOnce(new Error("Unknown lens design: nope"));
    await expect(quoteSale(container(), "est_1", [ownLine({ design_code: "nope" })])).rejects.toMatchObject({ reason: "bad_lens" });
  });

  it("carries the design's ADD requirement on the quoted line, and rxDesigns reads it", async () => {
    breakdown.mockResolvedValueOnce(fullBreakdown({ category: "prog", requires_add: true, total_cents: 18000, lens_base_cents: 18000, finish: "digital" }));
    const quote = await quoteSale(container(), "est_1", [ownLine({ design_code: "prog-mid" })]);
    expect(quote.lines[0].lens_category).toBe("prog");
    expect(quote.lines[0].lens_requires_add).toBe(true);
    expect(rxDesigns(quote)).toEqual([{ code: "prog-mid", category: "prog", requires_add: true }]);
  });
});

describe("checkPrescriptions applies the ADD and OCR rules before the lab validation", () => {
  const validate = jest.fn(() => ({ fulfillable: true, warnings: [] }));
  const scope = container({ prescription: { validate } });
  const prescription = (over: Record<string, unknown> = {}): RxInput =>
    ({
      rx: {
        od: { sph: -1, cyl: null, axis: null, add: 2, prism: null, base: null },
        os: { sph: -1, cyl: null, axis: null, add: 2, prism: null, base: null },
        pd: 62,
        pd_od: null,
        pd_os: null,
        seg_height: 18,
        source: "manual",
        verified_by_user: true,
        file_url: null,
        ...over,
      },
    }) as never;

  beforeEach(() => validate.mockClear());

  it("accepts a multifocal with its ADD and a single vision without one", () => {
    expect(() => checkPrescriptions(scope, { new: prescription(), worn: null }, true, [], [PROG])).not.toThrow();
    const sv = prescription({ od: { sph: -1, add: null }, os: { sph: -1, add: null } });
    expect(() => checkPrescriptions(scope, { new: sv, worn: null }, true, [], [SV])).not.toThrow();
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("rejects a single vision sold with an ADD (design_no_add) before asking the lab", () => {
    let caught: unknown;
    try {
      checkPrescriptions(scope, { new: prescription(), worn: null }, true, [], [SV]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PosError);
    expect(caught).toMatchObject({ reason: "design_no_add", status: 422, extra: { design_code: "sv", eye: "od" } });
    expect(validate).not.toHaveBeenCalled();
  });

  it("rejects a progressive without ADD (design_needs_add) and with unequal ADDs (rx_add_mismatch)", () => {
    const noAdd = prescription({ od: { sph: -1, add: null }, os: { sph: -1, add: null } });
    expect(() => checkPrescriptions(scope, { new: noAdd, worn: null }, true, [], [PROG])).toThrow(
      expect.objectContaining({ reason: "design_needs_add", status: 422 })
    );
    const uneven = prescription({ od: { sph: -1, add: 2 }, os: { sph: -1, add: 2.5 } });
    expect(() => checkPrescriptions(scope, { new: uneven, worn: null }, true, [], [BIFOCAL])).toThrow(
      expect.objectContaining({ reason: "rx_add_mismatch", extra: { design_code: "bifocal", category: "bifocal", od_add: 2, os_add: 2.5 } })
    );
  });

  it("rejects an OCR prescription the seller has not confirmed (rx_unconfirmed)", () => {
    const unconfirmed = prescription({ source: "ocr", verified_by_user: false });
    expect(() => checkPrescriptions(scope, { new: unconfirmed, worn: null }, true, [], [PROG])).toThrow(
      expect.objectContaining({ reason: "rx_unconfirmed", status: 422, extra: { field: "verified_by_user" } })
    );
    const missingFlag = prescription({ source: "ocr", verified_by_user: undefined });
    expect(() => checkPrescriptions(scope, { new: missingFlag, worn: null }, true, [], [PROG])).toThrow(
      expect.objectContaining({ reason: "rx_unconfirmed" })
    );
    const confirmed = prescription({ source: "ocr", verified_by_user: true });
    expect(() => checkPrescriptions(scope, { new: confirmed, worn: null }, true, [], [PROG])).not.toThrow();
  });

  it("with no lens design (frame only) the ADD rules do not apply", () => {
    expect(() => checkPrescriptions(scope, { new: prescription(), worn: null }, false, [], [])).not.toThrow();
  });
});
