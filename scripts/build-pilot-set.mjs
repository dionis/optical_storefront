/**
 * Builds the frame-media pilot cohort: a fixed, reviewable list of frames used to
 * shake out the generation pipeline before it is pointed at all 1,440 colourways.
 *
 * WHY A SCRIPT AND NOT A HAND-WRITTEN LIST
 * ----------------------------------------
 * The cohort has to be reproducible and explainable. A hand-picked list drifts (nobody
 * remembers why SKU X is in it), cannot be regenerated when the catalogue changes, and
 * tends to over-represent whatever the person was looking at that day. This picks by
 * stated rules and records, per frame, WHY it was chosen — so a disappointing pilot can
 * be read as "we under-sampled rimless" rather than argued about.
 *
 * WHY IT IS NOT A RANDOM SAMPLE
 * -----------------------------
 * A random 50 would be representative of the catalogue and useless as a test. The point
 * of a pilot is to find the failure modes cheaply, so it deliberately OVER-samples the
 * cases where an image model asked for "this exact frame from behind" is most likely to
 * invent a different one:
 *
 *   - transparent frames (clear/crystal) on the pure-white packshot background the
 *     prompts ask for — the frame and the background are the same colour;
 *   - rimless and semi-rimless builds, where there is no rim to carry identity;
 *   - thin metal and memory-wire, which a generative model happily thickens;
 *   - multi-tone finishes (fade, marble, tortoise), where colour placement is the
 *     identity and is easy to get plausibly wrong.
 *
 * Easy cases (opaque black acetate, full frame) are still included as a control: if
 * those fail too, the problem is the pipeline, not the frames.
 *
 * Deterministic: no RNG. Ties break on SKU, so two runs on the same catalogue produce
 * byte-identical output.
 *
 * Usage:  node scripts/build-pilot-set.mjs [--out <path>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, "apps", "capri-storefront", "public", "catalog.json");
// Lives next to the code that consumes it (src/lib/frame-media-pilot.ts), NOT under
// docs/data/ — that directory is gitignored because it holds real prescription scans,
// so a cohort written there would never be committed and the whole point of the pilot
// is that it is fixed and reviewable in version control.
const OUT_DEFAULT = join(ROOT, "apps", "backend", "src", "lib", "frame-media-pilot.json");

/** Brand → how many frames to take. Capri's own house brand, plus the hardest brand. */
const QUOTAS = [
  { brand: "Di Caprio", take: 50 },
  { brand: "Simplylite", take: 20 },
];

// ── Difficulty scoring ────────────────────────────────────────────────────────
// Higher = more likely to break identity preservation, therefore more worth testing.

/** Colourway names that vanish into a white background or encode colour placement. */
const COLOUR_RULES = [
  [/(clear|crystal)/i, 4, "transparent"],
  [/(light|champagne|beige|blush|blonde|tan|white|silver|lilac|mauve)/i, 2, "pale"],
  [/(fade|marble|tortoise|antique)/i, 2, "multitone"],
  [/(gold|gunmetal|rose)/i, 1, "metallic"],
];

function colourScore(name) {
  const tags = new Set();
  let score = 0;
  for (const [re, points, tag] of COLOUR_RULES) {
    if (re.test(name)) {
      score += points;
      tags.add(tag);
    }
  }
  // Three or more words means several finishes on one frame ("Burgundy Blue Red White").
  if (name.trim().split(/\s+/).length >= 3) {
    score += 1;
    tags.add("multitone");
  }
  return { score, tags: [...tags] };
}

function frameScore(product) {
  const attrs = product.attributes || {};
  const style = String(attrs.style || "");
  const materials = (attrs.material || []).join(" ");
  const tags = new Set();
  let score = 0;

  if (/rimless/i.test(style)) {
    // No rim means nothing anchors the shape. This is the single hardest case.
    score += 5;
    tags.add(/3-piece/i.test(style) ? "rimless-3piece" : "rimless");
  }
  if (/(metal|acero|titanio|memoria)/i.test(materials)) {
    score += 2;
    tags.add("thin-metal");
  }
  if (/(geom|navegador|aviador|redondo)/i.test(String(attrs.shape || ""))) {
    score += 1;
    tags.add("unusual-shape");
  }

  let best = { score: 0, tags: [] };
  for (const colour of product.colors || []) {
    const c = colourScore(colour.name || "");
    if (c.score > best.score) best = c;
  }
  score += best.score;
  best.tags.forEach((t) => tags.add(t));

  return { score, tags: [...tags].sort() };
}

// ── Selection ─────────────────────────────────────────────────────────────────

/** Share of each brand's quota reserved for the EASIEST frames. See CONTROL_SHARE note. */
const CONTROL_SHARE = 0.2;

/**
 * Picks `take` frames from `pool` in three passes: stratum coverage, then a reserved
 * control quota of the easiest frames, then the rest by difficulty.
 *
 * THE CONTROL QUOTA IS NOT OPTIONAL. Sorting by difficulty and taking the top N gives a
 * cohort of nothing but rimless crystal frames: it finds the hard failures and misses a
 * regression on the ordinary ones — which are 90% of the catalogue and 90% of the bill.
 * The first version of this script did exactly that and produced 70 frames with zero
 * controls, which is why the quota is reserved up front rather than hoped for.
 */
function pick(pool, take, strata) {
  const scored = pool
    .map((p) => ({ product: p, ...frameScore(p) }))
    .sort((a, b) =>
      b.score - a.score || String(a.product.sku).localeCompare(String(b.product.sku))
    );

  const chosen = new Map();
  const why = new Map();
  const add = (entry, reason) => {
    if (chosen.has(entry.product.sku) || chosen.size >= take) return;
    chosen.set(entry.product.sku, entry);
    why.set(entry.product.sku, reason);
  };

  // 1 — one frame per value of each stratum, so no shape/material/style is unrepresented.
  const controlQuota = Math.max(1, Math.round(take * CONTROL_SHARE));
  for (const stratum of strata) {
    const seen = new Set();
    for (const entry of scored) {
      const value = stratum.of(entry.product);
      if (value == null || seen.has(value)) continue;
      seen.add(value);
      if (chosen.size < take - controlQuota) add(entry, `coverage:${stratum.name}=${value}`);
    }
  }

  // 2 — the reserved controls: the easiest frames in the pool, taken from the bottom.
  const easiest = [...scored].reverse();
  let controls = 0;
  for (const entry of easiest) {
    if (controls >= controlQuota) break;
    if (chosen.has(entry.product.sku)) continue;
    add(entry, `control:ordinary(d=${entry.score})`);
    controls += 1;
  }

  // 3 — fill what is left with the hardest frames not already in.
  for (const entry of scored) {
    if (chosen.size >= take) break;
    add(entry, entry.tags.length ? `difficulty:${entry.tags.join("+")}` : "control:ordinary");
  }

  return [...chosen.values()]
    .sort((a, b) => String(a.product.sku).localeCompare(String(b.product.sku)))
    .map((e) => ({ ...e, reason: why.get(e.product.sku) }));
}

const STRATA = [
  { name: "shape", of: (p) => (p.attributes || {}).shape || null },
  { name: "material", of: (p) => ((p.attributes || {}).material || [])[0] || null },
  { name: "style", of: (p) => (p.attributes || {}).style || null },
  { name: "gender", of: (p) => (p.attributes || {}).gender || null },
  { name: "age", of: (p) => (p.attributes || {}).age || null },
];

// ── Main ──────────────────────────────────────────────────────────────────────

const raw = JSON.parse(readFileSync(CATALOG, "utf8"));
const catalogue = Array.isArray(raw) ? raw : raw.products || [];

const groups = [];
for (const { brand, take } of QUOTAS) {
  const pool = catalogue.filter((p) => p.brand === brand);
  if (!pool.length) throw new Error(`Brand not found in catalogue: ${brand}`);
  if (pool.length < take) throw new Error(`${brand} has ${pool.length} frames, need ${take}`);
  groups.push({ brand, take, picked: pick(pool, take, STRATA) });
}

/**
 * The Medusa product handle, as apps/scraper/scraper/parser.py:193 builds it:
 * `f"{_slug(name)}-{collection_slug}"`, where _slug lowercases and collapses every run
 * of non-alphanumerics into a single hyphen.
 *
 * NOTE THE TWO SLUGS. The storefront's bundled seed uses a DIFFERENT rule
 * (products.js:110 — `sku.toLowerCase().replace(/[^a-z0-9]+/g, "")`, which DELETES the
 * separator instead of replacing it), so "DC 50" is `dc-50-di-caprio` in Medusa and
 * `dc50` in the seed catalogue. catalogStore.matchProduct() reconciles the two at
 * render time. Enqueue talks to Medusa, so `handle` is the one it must use; `seed_slug`
 * is emitted alongside only so a human can find the frame in the local storefront.
 */
const medusaHandle = (name, brandSlug) =>
  `${String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${brandSlug}`;

const seedSlug = (sku) => String(sku).toLowerCase().replace(/[^a-z0-9]+/g, "");

const frames = groups.flatMap(({ brand, picked }) =>
  picked.map(({ product, score, tags, reason }) => ({
    sku: product.sku,
    handle: medusaHandle(product.name || product.sku, product.brand_slug),
    seed_slug: seedSlug(product.sku),
    brand,
    // Emitted because it is NOT derivable from the brand name: the supplier's
    // collection for "Simplylite" is `simply-lite` and for "Four You" it is `4u`.
    // Anything selecting by brand must match on this, not on a slugified name.
    brand_slug: product.brand_slug,
    colorways: (product.colors || []).map((c) => c.name),
    colorway_count: (product.colors || []).length,
    shape: (product.attributes || {}).shape || null,
    material: (product.attributes || {}).material || [],
    style: (product.attributes || {}).style || null,
    difficulty: score,
    tags,
    selected_because: reason,
  }))
);

const colorways = frames.reduce((sum, f) => sum + f.colorway_count, 0);

const manifest = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  generated_by: "scripts/build-pilot-set.mjs",
  source_catalog: "apps/capri-storefront/public/catalog.json",
  purpose:
    "Fixed pilot cohort for the frame-media generation pipeline. Deliberately over-samples " +
    "transparent, rimless, thin-metal and multi-tone frames — the cases where identity " +
    "preservation fails — with ordinary frames kept as a control.",
  totals: {
    frames: frames.length,
    colorways,
    views: colorways * 4,
    by_brand: Object.fromEntries(
      groups.map(({ brand, picked }) => [
        brand,
        {
          frames: picked.length,
          colorways: picked.reduce((s, e) => s + (e.product.colors || []).length, 0),
        },
      ])
    ),
  },
  tag_counts: frames.reduce((acc, f) => {
    for (const tag of f.tags) acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {}),
  frames,
};

const outIndex = process.argv.indexOf("--out");
const out = outIndex > -1 ? process.argv[outIndex + 1] : OUT_DEFAULT;
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`Pilot cohort → ${out}`);
console.log(`  frames    ${manifest.totals.frames}`);
console.log(`  colorways ${manifest.totals.colorways}`);
console.log(`  views     ${manifest.totals.views}`);
for (const [brand, t] of Object.entries(manifest.totals.by_brand)) {
  console.log(`  ${brand.padEnd(12)} ${t.frames} frames / ${t.colorways} colorways`);
}
console.log(`  tags      ${JSON.stringify(manifest.tag_counts)}`);
