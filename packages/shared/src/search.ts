/** Shape of a document indexed in Meilisearch index "frames" */
export interface MeilisearchFrameDocument {
  id: string;
  title: string;
  handle: string;
  collection: string;
  shape: string;
  material: string;
  gender: string;
  age_group: string;
  colors: string[];
  eye_size: number;
  bridge_size: number;
  temple_length: number;
  /** Lowest variant price in cents */
  price_from: number;
  features: string[];
  thumbnail: string;
}
