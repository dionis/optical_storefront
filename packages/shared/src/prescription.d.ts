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
/** Validation result returned by POST /store/prescriptions/validate */
export interface PrescriptionValidationResult {
    fulfillable: boolean;
    warnings: string[];
    /** Minimum recommended lens index given the Rx values */
    recommended_index: import("./lens-config.js").LensIndex | null;
}
//# sourceMappingURL=prescription.d.ts.map