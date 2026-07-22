export type UsageType =
  | "single_vision_distance"
  | "single_vision_reading"
  | "progressive"
  | "non_prescription";

export type LensIndex = 1.57 | 1.61 | 1.67 | 1.74;

export type CoatingType =
  | "anti_reflective"
  | "blue_light"
  | "photochromic"
  | "polarized"
  | "tint";

export interface LensConfig {
  usage_type: UsageType;
  index: LensIndex;
  coatings: CoatingType[];
  /** Computed total lens add-on price in cents */
  price_modifier_cents: number;
}

/** Stored in cart line item metadata */
export interface CartLensMetadata {
  lens_config: LensConfig;
  prescription: import("./prescription.js").Prescription | null;
  frame_price_cents: number;
  total_price_cents: number;
}
