export type FrameShape =
  | "round"
  | "oval"
  | "rectangle"
  | "square"
  | "cat_eye"
  | "aviator"
  | "browline"
  | "geometric"
  | "rimless"
  | "semi_rimless"
  | "other";

export type FrameMaterial =
  | "acetate"
  | "metal"
  | "titanium"
  | "stainless_steel"
  | "tr90"
  | "mixed"
  | "wood"
  | "other";

export interface FrameSize {
  /** Lens width in mm */
  eye_size: number;
  /** Bridge width in mm */
  bridge_size: number;
  /** Temple arm length in mm */
  temple_length: number;
}

export interface FrameAttributes {
  /** Horizontal lens width (A measurement) in mm */
  a: number | null;
  /** Vertical lens height (B measurement) in mm */
  b: number | null;
  /** Effective diameter in mm */
  ed: number | null;
  /** Circumference of the lens in mm */
  circ: number | null;
  eye_size: number;
  bridge_size: number;
  temple_length: number;
  material: FrameMaterial;
  shape: FrameShape;
  /** Sub-style descriptor, e.g. "full-rim", "wireless" */
  style: string;
  gender: "men" | "women" | "unisex";
  age_group: "adult" | "kids";
  features: string[];
  /** Map of color name → UPC code */
  upc_by_color: Record<string, string>;
  /** Slug of the collection this frame belongs to */
  collection_slug: string;
}
