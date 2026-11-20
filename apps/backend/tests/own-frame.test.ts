/** The customer's own frame at the till: brand, model, color and its printed size (A-DBL-temple). */
import { cleanLines, cleanOwnFrame, ownFrameSummary } from "../src/lib/pos";

const own = (extra: Record<string, unknown>) => ({ kind: "own_frame", selection: { design_code: "sv", material_code: "cr39" }, ...extra });

describe("own frame specs", () => {
  it("cleans brand, model, color and the three measures (half-mm steps)", () => {
    expect(cleanOwnFrame({ brand: " Ray-Ban ", model: "RB5154", color: "Negro", eye_size: "51", bridge: "21,5", temple: 145 })).toEqual({
      specs: { brand: "Ray-Ban", model: "RB5154", color: "Negro", eye_size: 51, bridge: 21.5, temple: 145 },
    });
    expect(cleanOwnFrame({})).toEqual({ specs: null });
    expect(cleanOwnFrame(null)).toEqual({ specs: null });
    expect(cleanOwnFrame({ eye_size: 12 })).toEqual({ reason: "bad_own_frame" });
    expect(cleanOwnFrame({ temple: "abc" })).toEqual({ reason: "bad_own_frame" });
    expect(cleanOwnFrame("x")).toEqual({ reason: "bad_own_frame" });
  });

  it("summarises it for the lab ticket and the line title", () => {
    const s = { brand: "Ray-Ban", model: "RB5154", color: "Negro", eye_size: 51, bridge: 21, temple: 145 };
    expect(ownFrameSummary(s)).toBe("Ray-Ban RB5154 · Negro · 51-21-145");
    expect(ownFrameSummary(s, "bisagra floja")).toBe("Ray-Ban RB5154 · Negro · 51-21-145 — bisagra floja");
    expect(ownFrameSummary(null, "Montura metálica dorada")).toBe("Montura metálica dorada");
    expect(ownFrameSummary(null)).toBeNull();
  });

  it("travels on the sale line; a bad size refuses the line", () => {
    const ok = cleanLines([own({ own_frame: { brand: "Oakley", eye_size: 54, bridge: 17, temple: 140 } })]);
    expect(ok).toMatchObject({ lines: [{ kind: "own_frame", own_frame: { brand: "Oakley", eye_size: 54, bridge: 17, temple: 140 }, description: "Oakley · 54-17-140" }] });
    expect(cleanLines([own({ own_frame: { bridge: 3 } })])).toEqual({ reason: "bad_own_frame" });
    // A catalog frame never carries own-frame specs.
    expect(cleanLines([{ kind: "frame", variant_id: "var_1", selection: { design_code: "frame-only" }, own_frame: { brand: "X" } }])).toMatchObject({ lines: [{ own_frame: null }] });
  });
});
