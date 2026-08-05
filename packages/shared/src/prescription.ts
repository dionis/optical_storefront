export type PrescriptionSource = "manual" | "ocr";

export interface PrescriptionEye {
  /** Sphere power, range -20.00 to +12.00, step 0.25 */
  sph: number | null;
  /** Cylinder power, range -6.00 to +6.00, step 0.25 */
  cyl: number | null;
  /** Axis in degrees, integer 1-180; required when cyl ≠ 0 */
  axis: number | null;
  /** Addition power for progressive/reading, range +0.75 to +4.00 */
  add: number | null;
  /** Prism diopters */
  prism: number | null;
  /** Prism base direction */
  base: string | null;
}

export interface Prescription {
  id?: string;
  /** Right eye (oculus dexter) */
  od: PrescriptionEye;
  /** Left eye (oculus sinister) */
  os: PrescriptionEye;
  /** Pupillary distance in mm (50-80) — single value when both eyes share one PD */
  pd: number | null;
  /** Right eye PD when dual PD is measured separately (25-40 per eye) */
  pd_od: number | null;
  /** Left eye PD when dual PD is measured separately (25-40 per eye) */
  pd_os: number | null;
  source: PrescriptionSource;
  /** User has reviewed and explicitly confirmed the values */
  verified_by_user: boolean;
  /** R2 object key of the uploaded prescription image/PDF — null for manual entry */
  file_url: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Machine-readable reasons a prescription is questionable or unfulfillable.
 *
 * The backend must never emit prose here: it has no idea which language the
 * customer is browsing in, and copy written server-side bypasses the storefront
 * dictionary entirely — which is how Spanish warnings ended up inside an English
 * page. The storefront maps each code to localized copy via `t()`.
 */
export type PrescriptionWarningCode =
  | "sph_out_of_range"
  | "sph_not_step"
  | "cyl_out_of_range"
  | "cyl_not_step"
  | "axis_required"
  | "axis_out_of_range"
  | "add_out_of_range"
  | "add_required_progressive"
  | "pd_dual_out_of_range"
  | "pd_single_out_of_range"
  | "high_rx_index_recommended"
  | "small_frame_high_rx";

export interface PrescriptionWarning {
  code: PrescriptionWarningCode;
  /** Set when the warning is about one eye in particular. */
  eye?: "od" | "os";
  /** Values interpolated into the localized message, as `{name}` placeholders. */
  params?: Record<string, string | number>;
}

/**
 * Machine-readable reasons a prescription request failed.
 *
 * Same contract as `PrescriptionWarningCode`: the server sends a code, the
 * storefront owns the wording. The `error` field that travels alongside is
 * English developer text for logs — never render it to a customer.
 */
export type PrescriptionErrorCode =
  | "file_required"
  | "file_too_large"
  | "unsupported_media_type"
  | "ocr_unavailable"
  | "ocr_rate_limited"
  | "ocr_failed"
  | "ocr_unreadable"
  | "prescription_required"
  | "ocr_not_confirmed";

/** Validation result returned by POST /store/prescriptions/validate */
export interface PrescriptionValidationResult {
  fulfillable: boolean;
  warnings: PrescriptionWarning[];
  /** Minimum recommended lens index given the Rx values */
  recommended_index: import("./lens-config.js").LensIndex | null;
}
