import { validatePrescription, DEFAULT_RX_RANGES } from "../src/modules/prescription/validation";
import type { Prescription } from "@eyewear/shared";

function buildRx(overrides: Partial<Prescription> = {}): Prescription {
  return {
    od: { sph: 0, cyl: 0, axis: null, add: null, prism: null, base: null },
    os: { sph: 0, cyl: 0, axis: null, add: null, prism: null, base: null },
    pd: 63,
    pd_od: null,
    pd_os: null,
    source: "manual",
    verified_by_user: true,
    file_url: null,
    ...overrides,
  };
}

describe("validatePrescription", () => {
  it("accepts a normal prescription", () => {
    const rx = buildRx({
      od: { sph: -2.0, cyl: -1.25, axis: 90, add: null, prism: null, base: null },
      os: { sph: -1.75, cyl: -0.75, axis: 180, add: null, prism: null, base: null },
    });
    const result = validatePrescription(rx);
    expect(result.fulfillable).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("rejects SPH out of range", () => {
    const rx = buildRx({
      od: { sph: -22, cyl: 0, axis: null, add: null, prism: null, base: null },
      os: { sph: 0, cyl: 0, axis: null, add: null, prism: null, base: null },
    });
    const result = validatePrescription(rx);
    expect(result.fulfillable).toBe(false);
    expect(result.warnings.some((w) => w.code === "sph_out_of_range")).toBe(true);
  });

  it("requires AXIS when CYL is non-zero", () => {
    const rx = buildRx({
      od: { sph: -1, cyl: -1.25, axis: null, add: null, prism: null, base: null },
      os: { sph: 0, cyl: 0, axis: null, add: null, prism: null, base: null },
    });
    const result = validatePrescription(rx);
    expect(result.fulfillable).toBe(false);
    expect(result.warnings.some((w) => w.code === "axis_required")).toBe(true);
  });

  it("recommends index 1.67 for high Rx (|SPH| > 4)", () => {
    const rx = buildRx({
      od: { sph: -5.0, cyl: 0, axis: null, add: null, prism: null, base: null },
      os: { sph: -4.5, cyl: 0, axis: null, add: null, prism: null, base: null },
    });
    const result = validatePrescription(rx);
    expect(result.recommended_index).toBe(1.67);
    expect(result.fulfillable).toBe(true);
  });

  it("recommends index 1.67 for high Rx (|CYL| > 2)", () => {
    const rx = buildRx({
      od: { sph: 0, cyl: -2.5, axis: 90, add: null, prism: null, base: null },
      os: { sph: 0, cyl: -1, axis: 45, add: null, prism: null, base: null },
    });
    const result = validatePrescription(rx);
    expect(result.recommended_index).toBe(1.67);
  });

  it("rejects rimless frame with |SPH| > 6", () => {
    const rx = buildRx({
      od: { sph: -7.0, cyl: 0, axis: null, add: null, prism: null, base: null },
      os: { sph: -7.0, cyl: 0, axis: null, add: null, prism: null, base: null },
    });
    const result = validatePrescription(rx, DEFAULT_RX_RANGES, {
      eye_size: 44,
    });
    expect(result.fulfillable).toBe(false);
    expect(result.warnings.some((w) => w.code === "small_frame_high_rx")).toBe(true);
  });

  it("requires ADD for progressive", () => {
    const rx = buildRx({
      od: { sph: -1, cyl: 0, axis: null, add: null, prism: null, base: null },
      os: { sph: -1, cyl: 0, axis: null, add: null, prism: null, base: null },
    });
    const result = validatePrescription(rx, DEFAULT_RX_RANGES, {
      usage_type: "progressive",
    });
    expect(result.fulfillable).toBe(false);
    expect(result.warnings.some((w) => w.code === "add_required_progressive")).toBe(true);
  });

  it("validates dual PD range", () => {
    const rx = buildRx({
      pd: null,
      pd_od: 24,
      pd_os: 24,
    });
    const result = validatePrescription(rx);
    expect(result.fulfillable).toBe(false);
    expect(result.warnings.some((w) => w.code === "pd_dual_out_of_range")).toBe(true);
  });

  it("validates single PD range", () => {
    const rx = buildRx({ pd: 85 });
    const result = validatePrescription(rx);
    expect(result.fulfillable).toBe(false);
    expect(result.warnings.some((w) => w.code === "pd_single_out_of_range")).toBe(true);
  });
});
