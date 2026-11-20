import { cleanClinical, linesGained, normalizeVa, vaLogMar } from "../src/lib/visual-acuity";
import { cleanRxMeta } from "../src/lib/pos";

/** Visual acuity sc/cc and dominant eye (owner, 18-nov-2026); same cases as the panel's scripts/test-visual-acuity.mjs. */
describe("visual acuity", () => {
  it("normalizes what the store writes to Snellen 20-ft notation", () => {
    const cases: Array<[string, string | null]> = [
      ["20/20", "20/20"], ["20", "20/20"], ["40", "20/40"], ["100-2", "20/100-2"], ["20/100 -2", "20/100-2"], ["20/25+1", "20/25+1"],
      ["6/6", "20/20"], ["6/12", "20/40"], ["0.5", "20/40"], ["1", "20/20"], ["cd", "CF"], ["MM", "HM"], ["pl", "LP"], ["NPL", "NLP"],
      ["", ""], ["20/33", null], ["abc", null], ["20/100-9", null],
    ];
    for (const [raw, want] of cases) expect([raw, normalizeVa(raw)]).toEqual([raw, want]);
  });
  it("logMAR: 20/20 = 0, one line = 0.1, letters ± 0.02, low vision by convention", () => {
    expect(vaLogMar("20/20")).toBe(0);
    expect(vaLogMar("20/25")).toBe(0.1);
    expect(vaLogMar("20/100-2")).toBe(0.74);
    expect(vaLogMar("CF")).toBe(1.9);
    expect(vaLogMar("")).toBeNull();
  });
  it("cleans the till's block, says which field is wrong, null when empty", () => {
    const ok = cleanClinical({ va: { sc: { od: "100-2", os: "100-2" }, cc: { od: "20", os: "20", ou: "20" } }, dominant_eye: "od" });
    expect(ok).toEqual({ va: { sc: { od: "20/100-2", os: "20/100-2", ou: "" }, cc: { od: "20/20", os: "20/20", ou: "20/20" } }, dominant_eye: "od" });
    expect(cleanClinical({ va: { cc: { os: "20/33" } } })).toEqual({ reason: "va_invalid", field: "cc.os" });
    expect(cleanClinical({ dominant_eye: "left" })).toEqual({ reason: "dominant_eye_invalid" });
    expect(cleanClinical({ va: { sc: { od: "" } } })).toBeNull();
    expect(cleanClinical(null)).toBeNull();
    expect(linesGained(ok as never)).toEqual({ od: 7, os: 7, ou: null });
  });
  it("travels with the prescription meta of the sale", () => {
    const m = cleanRxMeta({ rx_date: null, clinical: { dominant_eye: "os" } });
    expect(m).toMatchObject({ clinical: { dominant_eye: "os" } });
    expect(cleanRxMeta({ clinical: { va: { sc: { od: "x" } } } })).toEqual({ reason: "va_invalid", field: "sc.od" });
    expect(cleanRxMeta({ rx_date: null })).not.toHaveProperty("clinical");
  });
});
