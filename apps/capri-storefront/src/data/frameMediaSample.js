/**
 * Every generated view that exists today, so the gallery can be built and reviewed
 * before the backend feeds it. DEV ONLY — nothing shipped imports this.
 *
 * 21 frames · 33 colourways · 132 views, all four angles present. These are the real
 * files the pilot produced and uploaded, not placeholders: what you see while wiring
 * the gallery is what a customer would see.
 *
 * VALUES ARE R2 OBJECT KEYS, NOT URLS — exactly the shape `variant.metadata.views`
 * will hold. That is deliberate: it forces anything reading them through
 * `resolveImage()` like every other product image. Render a bare key and you get the
 * grey 404 box instead of it working by accident.
 *
 * Regenerate after another run:
 *   cd apps/scraper && uv run python -m scraper media results --pilot --limit 200
 */

/** Keyed by Medusa handle → colourway → slot. R2 object keys, never URLs. */
export const GENERATED_VIEWS = {
  "dc-50-di-caprio": {
    "Grey": {
      front: "products/dc-50-di-caprio/views/dc-50-di-caprio_grey_front.webp",
      left: "products/dc-50-di-caprio/views/dc-50-di-caprio_grey_left.webp",
      right: "products/dc-50-di-caprio/views/dc-50-di-caprio_grey_right.webp",
      back: "products/dc-50-di-caprio/views/dc-50-di-caprio_grey_back.webp",
    },
    "Black": {
      front: "products/dc-50-di-caprio/views/dc-50-di-caprio_black_front.webp",
      left: "products/dc-50-di-caprio/views/dc-50-di-caprio_black_left.webp",
      right: "products/dc-50-di-caprio/views/dc-50-di-caprio_black_right.webp",
      back: "products/dc-50-di-caprio/views/dc-50-di-caprio_black_back.webp",
    },
    "Brown": {
      front: "products/dc-50-di-caprio/views/dc-50-di-caprio_brown_front.webp",
      left: "products/dc-50-di-caprio/views/dc-50-di-caprio_brown_left.webp",
      right: "products/dc-50-di-caprio/views/dc-50-di-caprio_brown_right.webp",
      back: "products/dc-50-di-caprio/views/dc-50-di-caprio_brown_back.webp",
    },
  },
  "sl103-simply-lite": {
    "Burgundy": {
      front: "products/sl103-simply-lite/views/sl103-simply-lite_burgundy_front.webp",
      left: "products/sl103-simply-lite/views/sl103-simply-lite_burgundy_left.webp",
      right: "products/sl103-simply-lite/views/sl103-simply-lite_burgundy_right.webp",
      back: "products/sl103-simply-lite/views/sl103-simply-lite_burgundy_back.webp",
    },
    "Pink": {
      front: "products/sl103-simply-lite/views/sl103-simply-lite_pink_front.webp",
      left: "products/sl103-simply-lite/views/sl103-simply-lite_pink_left.webp",
      right: "products/sl103-simply-lite/views/sl103-simply-lite_pink_right.webp",
      back: "products/sl103-simply-lite/views/sl103-simply-lite_pink_back.webp",
    },
  },
  "sl105-simply-lite": {
    "Silver": {
      front: "products/sl105-simply-lite/views/sl105-simply-lite_silver_front.webp",
      left: "products/sl105-simply-lite/views/sl105-simply-lite_silver_left.webp",
      right: "products/sl105-simply-lite/views/sl105-simply-lite_silver_right.webp",
      back: "products/sl105-simply-lite/views/sl105-simply-lite_silver_back.webp",
    },
    "Blue": {
      front: "products/sl105-simply-lite/views/sl105-simply-lite_blue_front.webp",
      left: "products/sl105-simply-lite/views/sl105-simply-lite_blue_left.webp",
      right: "products/sl105-simply-lite/views/sl105-simply-lite_blue_right.webp",
      back: "products/sl105-simply-lite/views/sl105-simply-lite_blue_back.webp",
    },
  },
  "sl106-simply-lite": {
    "Brown": {
      front: "products/sl106-simply-lite/views/sl106-simply-lite_brown_front.webp",
      left: "products/sl106-simply-lite/views/sl106-simply-lite_brown_left.webp",
      right: "products/sl106-simply-lite/views/sl106-simply-lite_brown_right.webp",
      back: "products/sl106-simply-lite/views/sl106-simply-lite_brown_back.webp",
    },
    "Black": {
      front: "products/sl106-simply-lite/views/sl106-simply-lite_black_front.webp",
      left: "products/sl106-simply-lite/views/sl106-simply-lite_black_left.webp",
      right: "products/sl106-simply-lite/views/sl106-simply-lite_black_right.webp",
      back: "products/sl106-simply-lite/views/sl106-simply-lite_black_back.webp",
    },
  },
  "sl107-simply-lite": {
    "Gunmetal": {
      front: "products/sl107-simply-lite/views/sl107-simply-lite_gunmetal_front.webp",
      left: "products/sl107-simply-lite/views/sl107-simply-lite_gunmetal_left.webp",
      right: "products/sl107-simply-lite/views/sl107-simply-lite_gunmetal_right.webp",
      back: "products/sl107-simply-lite/views/sl107-simply-lite_gunmetal_back.webp",
    },
    "Silver": {
      front: "products/sl107-simply-lite/views/sl107-simply-lite_silver_front.webp",
      left: "products/sl107-simply-lite/views/sl107-simply-lite_silver_left.webp",
      right: "products/sl107-simply-lite/views/sl107-simply-lite_silver_right.webp",
      back: "products/sl107-simply-lite/views/sl107-simply-lite_silver_back.webp",
    },
  },
  "sl108-simply-lite": {
    "Silver": {
      front: "products/sl108-simply-lite/views/sl108-simply-lite_silver_front.webp",
      left: "products/sl108-simply-lite/views/sl108-simply-lite_silver_left.webp",
      right: "products/sl108-simply-lite/views/sl108-simply-lite_silver_right.webp",
      back: "products/sl108-simply-lite/views/sl108-simply-lite_silver_back.webp",
    },
    "Gunmetal": {
      front: "products/sl108-simply-lite/views/sl108-simply-lite_gunmetal_front.webp",
      left: "products/sl108-simply-lite/views/sl108-simply-lite_gunmetal_left.webp",
      right: "products/sl108-simply-lite/views/sl108-simply-lite_gunmetal_right.webp",
      back: "products/sl108-simply-lite/views/sl108-simply-lite_gunmetal_back.webp",
    },
  },
  "sl110-simply-lite": {
    "Navy": {
      front: "products/sl110-simply-lite/views/sl110-simply-lite_navy_front.webp",
      left: "products/sl110-simply-lite/views/sl110-simply-lite_navy_left.webp",
      right: "products/sl110-simply-lite/views/sl110-simply-lite_navy_right.webp",
      back: "products/sl110-simply-lite/views/sl110-simply-lite_navy_back.webp",
    },
    "Black": {
      front: "products/sl110-simply-lite/views/sl110-simply-lite_black_front.webp",
      left: "products/sl110-simply-lite/views/sl110-simply-lite_black_left.webp",
      right: "products/sl110-simply-lite/views/sl110-simply-lite_black_right.webp",
      back: "products/sl110-simply-lite/views/sl110-simply-lite_black_back.webp",
    },
  },
  "sl113-simply-lite": {
    "Gunmetal": {
      front: "products/sl113-simply-lite/views/sl113-simply-lite_gunmetal_front.webp",
      left: "products/sl113-simply-lite/views/sl113-simply-lite_gunmetal_left.webp",
      right: "products/sl113-simply-lite/views/sl113-simply-lite_gunmetal_right.webp",
      back: "products/sl113-simply-lite/views/sl113-simply-lite_gunmetal_back.webp",
    },
    "Black": {
      front: "products/sl113-simply-lite/views/sl113-simply-lite_black_front.webp",
      left: "products/sl113-simply-lite/views/sl113-simply-lite_black_left.webp",
      right: "products/sl113-simply-lite/views/sl113-simply-lite_black_right.webp",
      back: "products/sl113-simply-lite/views/sl113-simply-lite_black_back.webp",
    },
  },
  "sl114-simply-lite": {
    "Black": {
      front: "products/sl114-simply-lite/views/sl114-simply-lite_black_front.webp",
      left: "products/sl114-simply-lite/views/sl114-simply-lite_black_left.webp",
      right: "products/sl114-simply-lite/views/sl114-simply-lite_black_right.webp",
      back: "products/sl114-simply-lite/views/sl114-simply-lite_black_back.webp",
    },
    "Gunmetal": {
      front: "products/sl114-simply-lite/views/sl114-simply-lite_gunmetal_front.webp",
      left: "products/sl114-simply-lite/views/sl114-simply-lite_gunmetal_left.webp",
      right: "products/sl114-simply-lite/views/sl114-simply-lite_gunmetal_right.webp",
      back: "products/sl114-simply-lite/views/sl114-simply-lite_gunmetal_back.webp",
    },
  },
  "sl115-simply-lite": {
    "Black": {
      front: "products/sl115-simply-lite/views/sl115-simply-lite_black_front.webp",
      left: "products/sl115-simply-lite/views/sl115-simply-lite_black_left.webp",
      right: "products/sl115-simply-lite/views/sl115-simply-lite_black_right.webp",
      back: "products/sl115-simply-lite/views/sl115-simply-lite_black_back.webp",
    },
    "Rose Gold": {
      front: "products/sl115-simply-lite/views/sl115-simply-lite_rose_gold_front.webp",
      left: "products/sl115-simply-lite/views/sl115-simply-lite_rose_gold_left.webp",
      right: "products/sl115-simply-lite/views/sl115-simply-lite_rose_gold_right.webp",
      back: "products/sl115-simply-lite/views/sl115-simply-lite_rose_gold_back.webp",
    },
  },
  "sl116-simply-lite": {
    "Gold": {
      front: "products/sl116-simply-lite/views/sl116-simply-lite_gold_front.webp",
      left: "products/sl116-simply-lite/views/sl116-simply-lite_gold_left.webp",
      right: "products/sl116-simply-lite/views/sl116-simply-lite_gold_right.webp",
      back: "products/sl116-simply-lite/views/sl116-simply-lite_gold_back.webp",
    },
    "Black": {
      front: "products/sl116-simply-lite/views/sl116-simply-lite_black_front.webp",
      left: "products/sl116-simply-lite/views/sl116-simply-lite_black_left.webp",
      right: "products/sl116-simply-lite/views/sl116-simply-lite_black_right.webp",
      back: "products/sl116-simply-lite/views/sl116-simply-lite_black_back.webp",
    },
  },
  "sl701-simply-lite": {
    "Silver": {
      front: "products/sl701-simply-lite/views/sl701-simply-lite_silver_front.webp",
      left: "products/sl701-simply-lite/views/sl701-simply-lite_silver_left.webp",
      right: "products/sl701-simply-lite/views/sl701-simply-lite_silver_right.webp",
      back: "products/sl701-simply-lite/views/sl701-simply-lite_silver_back.webp",
    },
  },
  "sl702-simply-lite": {
    "Gold": {
      front: "products/sl702-simply-lite/views/sl702-simply-lite_gold_front.webp",
      left: "products/sl702-simply-lite/views/sl702-simply-lite_gold_left.webp",
      right: "products/sl702-simply-lite/views/sl702-simply-lite_gold_right.webp",
      back: "products/sl702-simply-lite/views/sl702-simply-lite_gold_back.webp",
    },
  },
  "sl705-simply-lite": {
    "Gunmetal": {
      front: "products/sl705-simply-lite/views/sl705-simply-lite_gunmetal_front.webp",
      left: "products/sl705-simply-lite/views/sl705-simply-lite_gunmetal_left.webp",
      right: "products/sl705-simply-lite/views/sl705-simply-lite_gunmetal_right.webp",
      back: "products/sl705-simply-lite/views/sl705-simply-lite_gunmetal_back.webp",
    },
  },
  "sl901-simply-lite": {
    "Gold": {
      front: "products/sl901-simply-lite/views/sl901-simply-lite_gold_front.webp",
      left: "products/sl901-simply-lite/views/sl901-simply-lite_gold_left.webp",
      right: "products/sl901-simply-lite/views/sl901-simply-lite_gold_right.webp",
      back: "products/sl901-simply-lite/views/sl901-simply-lite_gold_back.webp",
    },
  },
  "sl902-simply-lite": {
    "Silver Blue": {
      front: "products/sl902-simply-lite/views/sl902-simply-lite_silver_blue_front.webp",
      left: "products/sl902-simply-lite/views/sl902-simply-lite_silver_blue_left.webp",
      right: "products/sl902-simply-lite/views/sl902-simply-lite_silver_blue_right.webp",
      back: "products/sl902-simply-lite/views/sl902-simply-lite_silver_blue_back.webp",
    },
  },
  "sl903-simply-lite": {
    "Gunmetal": {
      front: "products/sl903-simply-lite/views/sl903-simply-lite_gunmetal_front.webp",
      left: "products/sl903-simply-lite/views/sl903-simply-lite_gunmetal_left.webp",
      right: "products/sl903-simply-lite/views/sl903-simply-lite_gunmetal_right.webp",
      back: "products/sl903-simply-lite/views/sl903-simply-lite_gunmetal_back.webp",
    },
  },
  "sl904-simply-lite": {
    "Gold Brown": {
      front: "products/sl904-simply-lite/views/sl904-simply-lite_gold_brown_front.webp",
      left: "products/sl904-simply-lite/views/sl904-simply-lite_gold_brown_left.webp",
      right: "products/sl904-simply-lite/views/sl904-simply-lite_gold_brown_right.webp",
      back: "products/sl904-simply-lite/views/sl904-simply-lite_gold_brown_back.webp",
    },
  },
  "sl905-simply-lite": {
    "Gunmetal Black": {
      front: "products/sl905-simply-lite/views/sl905-simply-lite_gunmetal_black_front.webp",
      left: "products/sl905-simply-lite/views/sl905-simply-lite_gunmetal_black_left.webp",
      right: "products/sl905-simply-lite/views/sl905-simply-lite_gunmetal_black_right.webp",
      back: "products/sl905-simply-lite/views/sl905-simply-lite_gunmetal_black_back.webp",
    },
  },
  "sl906-simply-lite": {
    "Gold Black": {
      front: "products/sl906-simply-lite/views/sl906-simply-lite_gold_black_front.webp",
      left: "products/sl906-simply-lite/views/sl906-simply-lite_gold_black_left.webp",
      right: "products/sl906-simply-lite/views/sl906-simply-lite_gold_black_right.webp",
      back: "products/sl906-simply-lite/views/sl906-simply-lite_gold_black_back.webp",
    },
  },
  "sl907-simply-lite": {
    "Gold Gunmetal": {
      front: "products/sl907-simply-lite/views/sl907-simply-lite_gold_gunmetal_front.webp",
      left: "products/sl907-simply-lite/views/sl907-simply-lite_gold_gunmetal_left.webp",
      right: "products/sl907-simply-lite/views/sl907-simply-lite_gold_gunmetal_right.webp",
      back: "products/sl907-simply-lite/views/sl907-simply-lite_gold_gunmetal_back.webp",
    },
  },
};

/** Flat list for the dev index page: what exists, and why each frame is here. */
export const GENERATED_INDEX = [
  { handle: "dc-50-di-caprio", sku: "DC 50", brand: "Di Caprio",
    seedSlug: "dc50", tags: [],
    reason: "control:ordinary(d=0)", colorways: ["Grey","Black","Brown"], viewCount: 12 },
  { handle: "sl103-simply-lite", sku: "SL103", brand: "Simplylite",
    seedSlug: "sl103", tags: ["thin-metal"],
    reason: "control:ordinary(d=2)", colorways: ["Burgundy","Pink"], viewCount: 8 },
  { handle: "sl105-simply-lite", sku: "SL105", brand: "Simplylite",
    seedSlug: "sl105", tags: ["pale","rimless","thin-metal"],
    reason: "coverage:material=Metal", colorways: ["Silver","Blue"], viewCount: 8 },
  { handle: "sl106-simply-lite", sku: "SL106", brand: "Simplylite",
    seedSlug: "sl106", tags: ["rimless","thin-metal"],
    reason: "difficulty:rimless+thin-metal", colorways: ["Brown","Black"], viewCount: 8 },
  { handle: "sl107-simply-lite", sku: "SL107", brand: "Simplylite",
    seedSlug: "sl107", tags: ["pale","rimless","thin-metal"],
    reason: "difficulty:pale+rimless+thin-metal", colorways: ["Gunmetal","Silver"], viewCount: 8 },
  { handle: "sl108-simply-lite", sku: "SL108", brand: "Simplylite",
    seedSlug: "sl108", tags: ["pale","thin-metal"],
    reason: "coverage:style=Full frame", colorways: ["Silver","Gunmetal"], viewCount: 8 },
  { handle: "sl110-simply-lite", sku: "SL110", brand: "Simplylite",
    seedSlug: "sl110", tags: ["thin-metal"],
    reason: "control:ordinary(d=2)", colorways: ["Navy","Black"], viewCount: 8 },
  { handle: "sl113-simply-lite", sku: "SL113", brand: "Simplylite",
    seedSlug: "sl113", tags: ["metallic","thin-metal"],
    reason: "control:ordinary(d=3)", colorways: ["Gunmetal","Black"], viewCount: 8 },
  { handle: "sl114-simply-lite", sku: "SL114", brand: "Simplylite",
    seedSlug: "sl114", tags: ["metallic","thin-metal"],
    reason: "control:ordinary(d=3)", colorways: ["Black","Gunmetal"], viewCount: 8 },
  { handle: "sl115-simply-lite", sku: "SL115", brand: "Simplylite",
    seedSlug: "sl115", tags: ["metallic","rimless","thin-metal"],
    reason: "coverage:gender=Señoras", colorways: ["Black","Rose Gold"], viewCount: 8 },
  { handle: "sl116-simply-lite", sku: "SL116", brand: "Simplylite",
    seedSlug: "sl116", tags: ["metallic","rimless","thin-metal"],
    reason: "difficulty:metallic+rimless+thin-metal", colorways: ["Gold","Black"], viewCount: 8 },
  { handle: "sl701-simply-lite", sku: "SL701", brand: "Simplylite",
    seedSlug: "sl701", tags: ["pale","rimless-3piece","thin-metal"],
    reason: "coverage:shape=Rectángulo", colorways: ["Silver"], viewCount: 4 },
  { handle: "sl702-simply-lite", sku: "SL702", brand: "Simplylite",
    seedSlug: "sl702", tags: ["metallic","rimless-3piece","thin-metal"],
    reason: "coverage:shape=Ronda modificada", colorways: ["Gold"], viewCount: 4 },
  { handle: "sl705-simply-lite", sku: "SL705", brand: "Simplylite",
    seedSlug: "sl705", tags: ["metallic","rimless-3piece","thin-metal"],
    reason: "difficulty:metallic+rimless-3piece+thin-metal", colorways: ["Gunmetal"], viewCount: 4 },
  { handle: "sl901-simply-lite", sku: "SL901", brand: "Simplylite",
    seedSlug: "sl901", tags: ["metallic","rimless-3piece","thin-metal","unusual-shape"],
    reason: "coverage:shape=Geométrico", colorways: ["Gold"], viewCount: 4 },
  { handle: "sl902-simply-lite", sku: "SL902", brand: "Simplylite",
    seedSlug: "sl902", tags: ["pale","rimless-3piece","thin-metal"],
    reason: "coverage:shape=Óvalo modificado", colorways: ["Silver Blue"], viewCount: 4 },
  { handle: "sl903-simply-lite", sku: "SL903", brand: "Simplylite",
    seedSlug: "sl903", tags: ["metallic","rimless-3piece","thin-metal"],
    reason: "coverage:shape=Cuadrado", colorways: ["Gunmetal"], viewCount: 4 },
  { handle: "sl904-simply-lite", sku: "SL904", brand: "Simplylite",
    seedSlug: "sl904", tags: ["metallic","rimless-3piece","thin-metal"],
    reason: "difficulty:metallic+rimless-3piece+thin-metal", colorways: ["Gold Brown"], viewCount: 4 },
  { handle: "sl905-simply-lite", sku: "SL905", brand: "Simplylite",
    seedSlug: "sl905", tags: ["metallic","rimless-3piece","thin-metal"],
    reason: "difficulty:metallic+rimless-3piece+thin-metal", colorways: ["Gunmetal Black"], viewCount: 4 },
  { handle: "sl906-simply-lite", sku: "SL906", brand: "Simplylite",
    seedSlug: "sl906", tags: ["metallic","rimless-3piece","thin-metal"],
    reason: "difficulty:metallic+rimless-3piece+thin-metal", colorways: ["Gold Black"], viewCount: 4 },
  { handle: "sl907-simply-lite", sku: "SL907", brand: "Simplylite",
    seedSlug: "sl907", tags: ["metallic","rimless-3piece","thin-metal"],
    reason: "difficulty:metallic+rimless-3piece+thin-metal", colorways: ["Gold Gunmetal"], viewCount: 4 },
];

/**
 * Merges the generated views into a catalogue product, for developing against.
 *
 *   const shown = withGeneratedViews(product);
 *
 * Returns the product untouched when nothing was generated for it — which is also
 * how the real thing behaves: a colourway with no media renders exactly as today.
 */
export function withGeneratedViews(product) {
  const sample = product && GENERATED_VIEWS[product.slug];
  if (!sample) return product;
  return {
    ...product,
    colors: (product.colors || []).map((colour) =>
      sample[colour.name]
        ? { ...colour, views: sample[colour.name], mediaGenerated: true }
        : colour
    ),
  };
}

/** Handles that have generated views, for "is there anything to show?" checks. */
export const GENERATED_HANDLES = GENERATED_INDEX.map((f) => f.handle);
