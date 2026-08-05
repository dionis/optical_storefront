import type {
  Prescription,
  PrescriptionValidationResult,
  PrescriptionWarning,
  LensIndex,
} from "@eyewear/shared";

/**
 * Fulfillability ranges (configurable via env with these defaults).
 * Values are inclusive bounds.
 */
export interface RxRanges {
  sph_min: number;
  sph_max: number;
  cyl_min: number;
  cyl_max: number;
  axis_min: number;
  axis_max: number;
  add_min: number;
  add_max: number;
  pd_single_min: number;
  pd_single_max: number;
  pd_dual_min: number;
  pd_dual_max: number;
}

export const DEFAULT_RX_RANGES: RxRanges = {
  sph_min: -20.0,
  sph_max: 12.0,
  cyl_min: -6.0,
  cyl_max: 6.0,
  axis_min: 1,
  axis_max: 180,
  add_min: 0.75,
  add_max: 4.0,
  pd_single_min: 50,
  pd_single_max: 80,
  pd_dual_min: 25,
  pd_dual_max: 40,
};

/**
 * Validates a prescription and returns fulfillability, warnings,
 * and recommended lens index.  Called by the API route and before checkout.
 *
 * Warnings are emitted as codes plus parameters, never as sentences: this runs
 * server-side with no knowledge of the customer's language, and the storefront
 * owns all user-facing copy.
 */
export function validatePrescription(
  rx: Prescription,
  ranges: RxRanges = DEFAULT_RX_RANGES,
  context: { usage_type?: string; eye_size?: number } = {}
): PrescriptionValidationResult {
  const warnings: PrescriptionWarning[] = [];
  let fulfillable = true;

  const eyes = [
    { eye: "od", data: rx.od },
    { eye: "os", data: rx.os },
  ] as const;

  for (const { eye, data } of eyes) {
    if (data.sph !== null) {
      if (data.sph < ranges.sph_min || data.sph > ranges.sph_max) {
        warnings.push({
          code: "sph_out_of_range",
          eye,
          params: { value: data.sph, min: ranges.sph_min, max: ranges.sph_max },
        });
        fulfillable = false;
      }
      if (!isMultipleOf025(data.sph)) {
        warnings.push({ code: "sph_not_step", eye, params: { step: 0.25 } });
        fulfillable = false;
      }
    }

    if (data.cyl !== null) {
      if (data.cyl < ranges.cyl_min || data.cyl > ranges.cyl_max) {
        warnings.push({
          code: "cyl_out_of_range",
          eye,
          params: { value: data.cyl, min: ranges.cyl_min, max: ranges.cyl_max },
        });
        fulfillable = false;
      }
      if (!isMultipleOf025(data.cyl)) {
        warnings.push({ code: "cyl_not_step", eye, params: { step: 0.25 } });
        fulfillable = false;
      }
      // Axis required when CYL ≠ 0
      if (data.cyl !== 0) {
        if (data.axis === null) {
          warnings.push({ code: "axis_required", eye });
          fulfillable = false;
        } else if (
          data.axis < ranges.axis_min ||
          data.axis > ranges.axis_max
        ) {
          warnings.push({
            code: "axis_out_of_range",
            eye,
            params: { value: data.axis, min: ranges.axis_min, max: ranges.axis_max },
          });
          fulfillable = false;
        }
      }
    }

    if (data.add !== null) {
      if (data.add < ranges.add_min || data.add > ranges.add_max) {
        warnings.push({
          code: "add_out_of_range",
          eye,
          params: { value: data.add, min: ranges.add_min, max: ranges.add_max },
        });
        fulfillable = false;
      }
    }
  }

  // ADD required for progressive
  if (context.usage_type === "progressive") {
    if (rx.od.add === null || rx.os.add === null) {
      warnings.push({ code: "add_required_progressive" });
      fulfillable = false;
    }
  }

  // PD validation
  const hasDualPd = rx.pd_od !== null || rx.pd_os !== null;
  if (hasDualPd) {
    for (const [eye, val] of [
      ["od", rx.pd_od],
      ["os", rx.pd_os],
    ] as const) {
      if (val !== null && (val < ranges.pd_dual_min || val > ranges.pd_dual_max)) {
        warnings.push({
          code: "pd_dual_out_of_range",
          eye,
          params: { value: val, min: ranges.pd_dual_min, max: ranges.pd_dual_max },
        });
        fulfillable = false;
      }
    }
  } else if (rx.pd !== null) {
    if (rx.pd < ranges.pd_single_min || rx.pd > ranges.pd_single_max) {
      warnings.push({
        code: "pd_single_out_of_range",
        params: { value: rx.pd, min: ranges.pd_single_min, max: ranges.pd_single_max },
      });
      fulfillable = false;
    }
  }

  // High-Rx rule
  const maxSph = Math.max(
    Math.abs(rx.od.sph ?? 0),
    Math.abs(rx.os.sph ?? 0)
  );
  const maxCyl = Math.max(
    Math.abs(rx.od.cyl ?? 0),
    Math.abs(rx.os.cyl ?? 0)
  );
  const isHighRx = maxSph > 4 || maxCyl > 2;

  let recommended_index: LensIndex | null = null;
  if (isHighRx) {
    recommended_index = 1.67;
    warnings.push({
      code: "high_rx_index_recommended",
      params: { index: 1.67 },
    });
  }

  // Rimless / small-frame rule
  if (context.eye_size !== undefined && context.eye_size < 46) {
    if (maxSph > 6) {
      warnings.push({
        code: "small_frame_high_rx",
        params: { eye_size: context.eye_size, max_sph: 6 },
      });
      fulfillable = false;
    }
  }

  return { fulfillable, warnings, recommended_index };
}

function isMultipleOf025(value: number): boolean {
  return Math.round(value * 4) === value * 4;
}
