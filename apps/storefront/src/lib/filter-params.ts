/**
 * Serialises/deserialises the listing page filter state to/from URL search params.
 * This keeps all filter state in the URL for shareability and browser history.
 */

export interface ListingFilters {
  query: string;
  shapes: string[];
  materials: string[];
  genders: string[];
  collections: string[];
  features: string[];
  /** Derived size buckets: "narrow" (<50 mm), "medium" (50-54), "wide" (≥55) */
  sizes: SizeBucket[];
  colors: string[];
  sort: SortOption;
}

export type SizeBucket = "narrow" | "medium" | "wide";
export type SortOption = "relevance" | "price_asc" | "price_desc" | "title_asc";

export const SIZE_BUCKET_FILTERS: Record<SizeBucket, string> = {
  narrow: "eye_size < 50",
  medium: "eye_size >= 50 AND eye_size <= 54",
  wide: "eye_size >= 55",
};

export const SIZE_BUCKET_LABELS: Record<SizeBucket, string> = {
  narrow: "Estrecho (< 50 mm)",
  medium: "Mediano (50–54 mm)",
  wide: "Ancho (≥ 55 mm)",
};

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Relevancia" },
  { value: "price_asc", label: "Precio: menor a mayor" },
  { value: "price_desc", label: "Precio: mayor a menor" },
  { value: "title_asc", label: "Nombre A–Z" },
];

export const MEILI_SORT_PARAMS: Record<SortOption, string[]> = {
  relevance: [],
  price_asc: ["price_from:asc"],
  price_desc: ["price_from:desc"],
  title_asc: ["title:asc"],
};

const EMPTY: ListingFilters = {
  query: "",
  shapes: [],
  materials: [],
  genders: [],
  collections: [],
  features: [],
  sizes: [],
  colors: [],
  sort: "relevance",
};

function splitParam(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseFilterParams(
  params: Record<string, string | string[] | undefined>
): ListingFilters {
  const get = (key: string) =>
    Array.isArray(params[key]) ? (params[key] as string[])[0] : (params[key] as string | undefined);

  return {
    query: get("q") ?? "",
    shapes: splitParam(get("shape")),
    materials: splitParam(get("material")),
    genders: splitParam(get("gender")),
    collections: splitParam(get("collection")),
    features: splitParam(get("feature")),
    sizes: splitParam(get("size")) as SizeBucket[],
    colors: splitParam(get("color")),
    sort: (get("sort") as SortOption) ?? "relevance",
  };
}

export function filtersToSearchParams(
  filters: ListingFilters
): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.query) p.set("q", filters.query);
  if (filters.shapes.length) p.set("shape", filters.shapes.join(","));
  if (filters.materials.length) p.set("material", filters.materials.join(","));
  if (filters.genders.length) p.set("gender", filters.genders.join(","));
  if (filters.collections.length) p.set("collection", filters.collections.join(","));
  if (filters.features.length) p.set("feature", filters.features.join(","));
  if (filters.sizes.length) p.set("size", filters.sizes.join(","));
  if (filters.colors.length) p.set("color", filters.colors.join(","));
  if (filters.sort !== "relevance") p.set("sort", filters.sort);
  return p;
}

export function buildMeiliFilter(filters: ListingFilters): string {
  const parts: string[] = [];

  const inFilter = (attr: string, values: string[]) => {
    if (!values.length) return;
    const quoted = values.map((v) => `"${v}"`).join(", ");
    parts.push(`${attr} IN [${quoted}]`);
  };

  inFilter("shape", filters.shapes);
  inFilter("material", filters.materials);
  inFilter("gender", filters.genders);
  inFilter("collection", filters.collections);

  if (filters.features.length) {
    // features is an array attribute — use each as a separate condition
    for (const f of filters.features) {
      parts.push(`features = "${f}"`);
    }
  }

  if (filters.colors.length) {
    for (const c of filters.colors) {
      parts.push(`colors = "${c}"`);
    }
  }

  if (filters.sizes.length) {
    const sizeParts = filters.sizes.map((s) => `(${SIZE_BUCKET_FILTERS[s]})`);
    parts.push(`(${sizeParts.join(" OR ")})`);
  }

  return parts.join(" AND ");
}

export function countActiveFilters(filters: ListingFilters): number {
  return (
    filters.shapes.length +
    filters.materials.length +
    filters.genders.length +
    filters.collections.length +
    filters.features.length +
    filters.sizes.length +
    filters.colors.length
  );
}

export { EMPTY as EMPTY_FILTERS };
