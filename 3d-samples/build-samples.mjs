/**
 * Builds the 3D-reconstruction sample dataset: every reference image the
 * supplier publishes for each frame, plus one JSON descriptor per frame and an
 * index.
 *
 * Source of truth is the scraped supplier catalog
 * (apps/capri-storefront/public/catalog.json). Everything read from there is
 * copied verbatim into `catalog_attributes_raw`; everything this script computes
 * is marked with a `confidence` field so a consumer can tell measured supplier
 * data apart from our estimates.
 *
 * On images: the supplier publishes one photo per colourway and nothing else.
 * The extra URLs on a product page (`-300x123`, `-1024x419`, …) are WordPress
 * thumbnail resizes of that same shot, so they are deliberately not downloaded —
 * they add pixels, never a new angle.
 *
 * Usage:  node 3d-samples/build-samples.mjs
 * Images already present under images/ are not re-downloaded.
 */

import { createRequire } from "node:module";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_REL = "apps/capri-storefront/public/catalog.json";
const CATALOG = path.join(HERE, "..", CATALOG_REL);
const GENERATED_AT = new Date().toISOString();

/**
 * The seven frames. Chosen so the set spans the construction types a 3D
 * pipeline has to handle differently: thick acetate, injected plastic, wire
 * metal, semi-rimless (nylon cord), drilled rimless, and mixed-material combos.
 *
 * `observed` holds what is actually visible in the downloaded photos — checked
 * image by image, not inferred from the catalog text. It describes the frame
 * itself, so it holds for every colourway of that model.
 * `hints` are modelling heuristics for typical eyewear of that construction;
 * they are NOT supplier data and are emitted with confidence: "heuristic".
 */
const SELECTION = [
  {
    id: "dc384",
    sku: "DC384",
    primary_colorway: "Black",
    why: "Thick acetate full-rim rectangle — the baseline case: large flat surfaces, visible bevel, chunky temples.",
    observed: {
      rim: "full rim, thick glossy acetate, visible inner bevel groove",
      bridge: "single straight bridge",
      nose_pads: "separate clear plastic pads on short metal arms",
      hardware: "two silver rivets on each end piece, metal barrel hinge",
      markings: "'DC384 Capri' printed inside left temple, 'Frame China' inside right",
    },
    hints: {
      rim_thickness_mm: 6.5,
      front_thickness_mm: 5,
      temple_max_width_mm: 9,
      temple_thickness_mm: 4.5,
      base_curve: 4,
      pantoscopic_tilt_deg: 8,
      face_form_wrap_deg: 5,
      hinge: "metal barrel hinge, riveted",
      nose_pad_type: "plastic pads on arms",
    },
  },
  {
    id: "up327",
    sku: "UP 327",
    primary_colorway: "Black Tan",
    why: "Injected plastic cat-eye with two-tone layering — tests non-convex silhouette and a colour split that is not a material split.",
    observed: {
      rim: "full rim, injected plastic, upswept outer corners, thicker at the brow",
      bridge: "single bridge, moulded into the front",
      nose_pads: "none visible — moulded saddle bridge",
      hardware: "metal barrel hinge, no decorative rivets",
      markings: "'UP327 Capri' printed inside left temple",
      colour_construction:
        "Two-tone by layered plastic, not by paint: an outer shell over a second colour that shows through on the inner rim and temples. The split lands in the same place on every colourway.",
    },
    hints: {
      rim_thickness_mm: 7.5,
      front_thickness_mm: 5.5,
      temple_max_width_mm: 9,
      temple_thickness_mm: 4,
      base_curve: 4,
      pantoscopic_tilt_deg: 8,
      face_form_wrap_deg: 5,
      hinge: "metal barrel hinge",
      nose_pad_type: "integrated saddle bridge",
    },
  },
  {
    id: "dc186",
    sku: "DC186",
    primary_colorway: "Black Gold",
    why: "Combo build: acetate round front with thin gold metal temples — two materials, two very different cross-sections in one model.",
    observed: {
      rim: "full rim, glossy acetate, round",
      bridge: "single bridge with a shallow keyhole profile",
      nose_pads: "none clearly visible from this angle",
      hardware: "metal end pieces and hinges, thin wire temples with acetate tips",
      markings: "'DC186 Capri' printed inside left temple",
    },
    hints: {
      rim_thickness_mm: 4.5,
      front_thickness_mm: 4,
      temple_wire_diameter_mm: 1.8,
      temple_tip_width_mm: 6,
      base_curve: 4,
      pantoscopic_tilt_deg: 8,
      face_form_wrap_deg: 5,
      hinge: "metal barrel hinge on the end piece",
      nose_pad_type: "unknown from these views",
    },
  },
  {
    id: "pt98",
    sku: "PT 98",
    primary_colorway: "Gold",
    why: "Wire-rim aviator with a brow bar — thin tubular geometry and a double bridge, the hardest silhouette to reconstruct from a single photo.",
    observed: {
      rim: "full rim, thin metal wire, teardrop aviator",
      bridge: "double: lower saddle bridge plus a straight upper brow bar",
      nose_pads: "adjustable clear pads on metal pad arms",
      hardware: "wire temples with tortoise plastic tips, screw hinges",
      markings: "'PT98 Capri' printed inside left temple",
    },
    hints: {
      rim_wire_diameter_mm: 1.6,
      brow_bar_diameter_mm: 1.4,
      temple_wire_diameter_mm: 1.4,
      temple_tip_width_mm: 5,
      base_curve: 6,
      pantoscopic_tilt_deg: 10,
      face_form_wrap_deg: 8,
      hinge: "screw hinge on metal end piece",
      nose_pad_type: "adjustable pads on arms",
    },
  },
  {
    id: "fx114",
    sku: "FX114",
    primary_colorway: "Black",
    why: "Semi-rimless (nylor): metal upper rim and a nylon cord holding the lens underneath — the lens edge is the visible silhouette, not the frame.",
    observed: {
      rim: "upper half only, metal; lower half is a thin nylon cord running in a groove in the lens edge",
      bridge: "single straight metal bridge",
      nose_pads: "adjustable pads on arms",
      hardware: "flat metal temples with plastic tips",
      markings: "'FX114 Capri' printed inside left temple",
    },
    hints: {
      upper_rim_thickness_mm: 2.2,
      nylon_cord_diameter_mm: 0.6,
      temple_width_mm: 3,
      temple_thickness_mm: 1.6,
      base_curve: 4,
      pantoscopic_tilt_deg: 8,
      face_form_wrap_deg: 5,
      hinge: "screw hinge, flat metal end piece",
      nose_pad_type: "adjustable pads on arms",
      modelling_note:
        "The lower lens outline must be modelled from the lens, not from frame geometry; the cord sits in a groove cut into the lens edge.",
    },
  },
  {
    id: "sl906",
    sku: "SL906",
    primary_colorway: "Gold Black",
    why: "Three-piece rimless titanium — no rim at all, lenses drilled and bolted. Also the only frame here whose photo already ships two camera views.",
    observed: {
      rim: "none — rimless, lens edge is the silhouette",
      bridge: "metal bridge bolted through the lenses",
      nose_pads: "clear pads on short arms off the bridge",
      hardware: "flat temples with a black overlay panel, black plastic tips",
      markings: "none legible",
    },
    hints: {
      lens_mount: "drilled, two holes per lens (bridge side and temple side)",
      bridge_wire_diameter_mm: 1.8,
      temple_width_mm: 2.5,
      temple_thickness_mm: 1.2,
      base_curve: 4,
      pantoscopic_tilt_deg: 8,
      face_form_wrap_deg: 5,
      hinge: "screw hinge on the temple-side mount",
      nose_pad_type: "pads on arms",
      modelling_note:
        "Frame and lens cannot be separated here: without the lens there is no closed silhouette. Model the lens as part of the asset.",
    },
  },
  {
    id: "dc391",
    sku: "DC391",
    primary_colorway: "Black Gold",
    why: "Metal navigator with a brow bar and plastic temples — square wire rim, two-tone anodising, mixed materials at the end piece.",
    observed: {
      rim: "full rim, flat metal, squared navigator shape",
      bridge: "double: lower bridge plus a straight upper brow bar",
      nose_pads: "adjustable clear pads on metal pad arms",
      hardware: "plastic temples over metal end pieces",
      markings: "'DC391 Capri' printed inside left temple",
    },
    hints: {
      rim_thickness_mm: 2,
      brow_bar_thickness_mm: 1.8,
      temple_width_mm: 6,
      temple_thickness_mm: 3,
      base_curve: 4,
      pantoscopic_tilt_deg: 8,
      face_form_wrap_deg: 6,
      hinge: "screw hinge on metal end piece",
      nose_pad_type: "adjustable pads on arms",
    },
  },
];

/**
 * Every image opened and looked at, keyed by `<id>/<colorway-slug>`.
 * `views` is what the frame is actually shot from; `layout` is how many shots
 * share the JPEG. Anything not listed here gets its layout guessed from the
 * aspect ratio and is flagged `verified: false` — a guess a consumer can
 * re-check, never a claim.
 */
const VERIFIED = {
  "dc384/black": { layout: "single_shot", views: ["three_quarter"] },
  "dc384/crystal": { layout: "single_shot", views: ["three_quarter"] },
  "dc384/light-brown": { layout: "single_shot", views: ["three_quarter"] },
  "up327/black-tan": { layout: "single_shot", views: ["three_quarter"] },
  "up327/blue-burgundy": { layout: "single_shot", views: ["three_quarter"] },
  "up327/burgundy-black": { layout: "single_shot", views: ["three_quarter"] },
  "dc186/black-gold": { layout: "single_shot", views: ["three_quarter"] },
  "dc186/crystal-blue": { layout: "single_shot", views: ["three_quarter"] },
  "dc186/crystal-gold": { layout: "single_shot", views: ["three_quarter"] },
  "pt98/gold": { layout: "single_shot", views: ["three_quarter"] },
  "pt98/gunmetal": { layout: "single_shot", views: ["three_quarter"] },
  "fx114/black": { layout: "single_shot", views: ["three_quarter"] },
  "fx114/blue": { layout: "single_shot", views: ["three_quarter"] },
  "fx114/gunmetal": { layout: "single_shot", views: ["three_quarter"] },
  "sl906/gold-black": {
    layout: "two_shots_stacked",
    views: ["three_quarter", "front"],
    note:
      "One JPEG holding two separate shots stacked vertically: three-quarter on top, near straight-on front below. Split it before feeding a single-view pipeline; the lower shot is the better one for measuring proportions.",
  },
  "dc391/black-gold": { layout: "single_shot", views: ["three_quarter"] },
  "dc391/gold": { layout: "single_shot", views: ["three_quarter"] },
  "dc391/gunmetal": { layout: "single_shot", views: ["three_quarter"] },
};

/** Geometry of the standard three-quarter studio shot used across the catalog. */
const THREE_QUARTER = {
  type: "three_quarter",
  yaw_deg_estimate: -35,
  pitch_deg_estimate: 15,
  temples: "open",
  confidence: "estimated_by_eye",
};
const FRONT = {
  type: "front",
  yaw_deg_estimate: 0,
  pitch_deg_estimate: 0,
  temples: "open",
  confidence: "estimated_by_eye",
};
const VIEW_SPEC = { three_quarter: THREE_QUARTER, front: FRONT };

/**
 * Single-shot catalog images are wide (roughly 2.2:1 or wider) because the
 * frame lies diagonally across the canvas; a JPEG holding stacked shots comes
 * out much squarer. Used only for images not in VERIFIED.
 */
const COMPOSITE_RATIO_THRESHOLD = 1.9;

const SHAPE_EN = {
  "Rectángulo": "rectangle",
  "Ojo de gato": "cat_eye",
  Redondo: "round",
  "Ronda modificada": "modified_round",
  Cuadrado: "square",
  Aviador: "aviator",
  Navegador: "navigator",
  "Geométrico": "geometric",
  "Óvalo modificado": "modified_oval",
  Oval: "oval",
  Shield: "shield",
};

const MATERIAL_EN = {
  Acetato: "acetate",
  "Plástica": "plastic",
  "Inyección": "injected_plastic",
  Metal: "metal",
  "Acero inoxidable": "stainless_steel",
  Titanio: "titanium",
  Memoria: "memory_metal",
  "TR-90": "tr90",
};

const GENDER_EN = { "Señoras": "women", Hombres: "men", Unisexo: "unisex" };
const AGE_EN = { Adulto: "adult", "Niños": "kids" };

/** Supplier "style" mixes rim type and construction, so Combo needs the photo. */
const RIM_TYPE = {
  "Full frame": "full_rim",
  "Full Rim": "full_rim",
  "Semi Rimless": "semi_rimless",
  "3-Piece Rimless": "rimless_3_piece",
  Combo: "full_rim",
  Sunglasses: "full_rim",
};

/** "48-50 mm" -> {min, max, nominal}; "Más de 60 mm" -> open-ended min only. */
function parseRange(raw) {
  if (!raw) return null;
  const open = raw.match(/M[áa]s de\s*(\d+)/i);
  if (open) {
    const min = Number(open[1]);
    return { raw, min, max: null, nominal: min, open_ended: true };
  }
  const nums = raw.match(/\d+(?:\.\d+)?/g);
  if (!nums) return { raw, min: null, max: null, nominal: null };
  const min = Number(nums[0]);
  const max = nums[1] != null ? Number(nums[1]) : min;
  return { raw, min, max, nominal: Math.round(((min + max) / 2) * 10) / 10, open_ended: false };
}

/** JPEG intrinsic size, read from the SOFn marker — no image library needed. */
async function jpegSize(file) {
  const buf = await readFile(file);
  if (buf.readUInt16BE(0) !== 0xffd8) return null;
  let off = 2;
  while (off < buf.length - 9) {
    if (buf[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = buf[off + 1];
    const len = buf.readUInt16BE(off + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSOF) return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    off += 2 + len;
  }
  return null;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  if (await exists(dest)) return "cached";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return "downloaded";
}

function slug(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const catalog = require(CATALOG);
  await mkdir(path.join(HERE, "frames"), { recursive: true });

  const index = [];
  let downloaded = 0;
  let cached = 0;

  for (const pick of SELECTION) {
    const product = catalog.find((p) => p.sku === pick.sku);
    if (!product) throw new Error(`SKU ${pick.sku} not found in ${CATALOG_REL}`);

    const attrs = product.attributes;
    await mkdir(path.join(HERE, "images", pick.id), { recursive: true });

    // Every colourway the supplier publishes — that is the complete set of
    // photographs that exist for this model.
    const images = [];
    for (const colour of product.colors) {
      const name = `${slug(colour.name)}.jpg`;
      const rel = `images/${pick.id}/${name}`;
      const abs = path.join(HERE, "images", pick.id, name);
      const state = await download(colour.image, abs);
      state === "cached" ? (cached += 1) : (downloaded += 1);

      const size = await jpegSize(abs);
      const ratio = size ? Math.round((size.width / size.height) * 100) / 100 : null;
      const known = VERIFIED[`${pick.id}/${slug(colour.name)}`];
      const layout = known
        ? known.layout
        : ratio != null && ratio < COMPOSITE_RATIO_THRESHOLD
          ? "two_shots_stacked"
          : "single_shot";
      const views = known ? known.views : layout === "single_shot" ? ["three_quarter"] : ["three_quarter", "front"];

      images.push({
        file: rel,
        colorway: colour.name,
        is_primary: colour.name === pick.primary_colorway,
        source_url: colour.image,
        width_px: size?.width ?? null,
        height_px: size?.height ?? null,
        aspect_ratio: ratio,
        background: "uniform white studio background",
        has_alpha: false,
        camera_calibration: "unknown — focal length, distance and sensor are not published",
        view_layout: {
          layout,
          shots: views.length,
          verified: Boolean(known),
          detected_by: known ? "opened and looked at" : "aspect ratio heuristic — re-check before relying on it",
          note: known?.note,
        },
        views: views.map((v) => VIEW_SPEC[v]),
      });
    }

    const distinctViews = new Set(images.flatMap((i) => i.views.map((v) => v.type)));

    const lens = parseRange(attrs.eye_size);
    const bridge = parseRange(attrs.bridge_size);
    const temple = parseRange(attrs.temple_length);
    const height = parseRange(attrs.b_measurement);

    // Standard optical approximation: total front width ≈ 2·A + DBL. It ignores
    // how far the end pieces stick out past the rims, so it runs a few mm short.
    const totalWidth =
      lens?.nominal != null && bridge?.nominal != null
        ? {
            nominal: Math.round((2 * lens.nominal + bridge.nominal) * 10) / 10,
            min: 2 * lens.min + bridge.min,
            max: 2 * lens.max + bridge.max,
            formula: "2 * lens_width_a + bridge_dbl",
            confidence: "estimated",
            note: "Excludes end-piece overhang; real total width typically runs 2-6 mm larger.",
          }
        : null;

    const doc = {
      schema_version: "1.1",
      generated_at: GENERATED_AT,
      id: pick.id,
      sku: product.sku,
      model_name: product.name,
      brand: { name: product.brand, slug: product.brand_slug },
      selected_because: pick.why,

      source: {
        supplier: "caprioptics.com",
        supplier_type: "WooCommerce B2B catalog, ingested by apps/scraper",
        catalog_file: CATALOG_REL,
        image_policy:
          "Every photo the supplier publishes for this model is downloaded — one per colourway. The extra URLs on a product page (-300x123, -1024x419, …) are WordPress thumbnail resizes of the same shot and are skipped.",
        rights_note:
          "Supplier product photography. Internal prototyping only — not cleared for redistribution.",
      },

      // Verbatim from the catalog, Spanish values untouched, so the derived
      // fields below can always be re-checked against the original.
      catalog_attributes_raw: attrs,

      classification: {
        lens_shape: SHAPE_EN[attrs.shape] ?? null,
        lens_shape_raw: attrs.shape ?? null,
        rim_type: RIM_TYPE[attrs.style] ?? null,
        rim_type_raw: attrs.style ?? null,
        rim_type_note:
          attrs.style === "Combo"
            ? "Supplier 'Combo' describes mixed-material construction, not rim type; rim type read from the photo."
            : undefined,
        materials: (attrs.material ?? []).map((m) => ({ raw: m, en: MATERIAL_EN[m] ?? null })),
        gender: GENDER_EN[attrs.gender] ?? null,
        age_group: AGE_EN[attrs.age] ?? null,
      },

      measurements_mm: {
        confidence: "supplier_published",
        note:
          "The supplier publishes a range per model because one model number covers several sizes. The photographed unit is one size inside that range and its exact size is not stated. Use `nominal` as the modelling target and the range as tolerance.",
        lens_width_a: lens,
        bridge_dbl: bridge,
        temple_length: temple,
        lens_height_b: height
          ? { ...height, note: "Published as a coarse bucket (e.g. 41-50 mm), so it is a weak constraint." }
          : null,
        derived_total_front_width: totalWidth,
      },

      // What is visible in the photos. Same frame in every colourway, so this
      // describes the model, not one image.
      observed_construction: { confidence: "observed_in_photos", ...pick.observed },

      // Everything here is a modelling default for this construction type,
      // not a measurement of this specific frame.
      geometry_hints_3d: {
        confidence: "heuristic",
        basis:
          "Typical values for this construction (material + rim type) plus what is visible in the reference photos. Not measured.",
        units: "mm",
        up_axis: "Y",
        forward_axis: "-Z",
        symmetry_plane: "x = 0 (bilateral)",
        recommended_origin: "Midpoint of the bridge on the front face of the frame",
        ...pick.hints,
      },

      reference_images: {
        directory: `images/${pick.id}/`,
        count: images.length,
        distinct_view_types: [...distinctViews],
        multi_view_usable: distinctViews.size > 1,
        note:
          distinctViews.size > 1
            ? "More than one camera angle exists for this model."
            : "All photos share the same camera angle: they differ in colour only, so they give no parallax. Treat this as a single-view reconstruction problem with several texture references.",
        items: images,
      },

      limitations: [
        "Multiple photos per model, but one per colourway and all from the same three-quarter angle — different finishes of the same geometry, not different viewpoints. There is no stereo baseline for photogrammetry.",
        "Camera intrinsics are unknown and the view is perspective, so pixel distances cannot be converted to millimetres directly. Scale the finished model from `measurements_mm` instead.",
        "The rear of the frame, the inner temple surfaces and the hinge interior are never visible.",
        "The supplier gives a size range, not the size of the photographed unit.",
        "`geometry_hints_3d` are construction defaults, not measurements of this frame.",
      ],
    };

    const outFile = path.join(HERE, "frames", `${pick.id}.json`);
    await writeFile(outFile, JSON.stringify(doc, null, 2) + "\n", "utf8");

    index.push({
      id: pick.id,
      sku: product.sku,
      brand: product.brand,
      json: `frames/${pick.id}.json`,
      images_dir: `images/${pick.id}/`,
      image_count: images.length,
      colorways: images.map((i) => i.colorway),
      distinct_view_types: [...distinctViews],
      lens_shape: doc.classification.lens_shape,
      rim_type: doc.classification.rim_type,
      materials: doc.classification.materials.map((m) => m.en ?? m.raw),
      selected_because: pick.why,
    });

    console.log(`${pick.sku.padEnd(8)} ${String(images.length).padStart(2)} img -> frames/${pick.id}.json`);
  }

  await writeFile(
    path.join(HERE, "index.json"),
    JSON.stringify(
      {
        schema_version: "1.1",
        generated_at: GENERATED_AT,
        purpose:
          "Reference dataset for 3D eyewear asset generation. Seven real frames from the supplier catalog, every published photo of each plus a full descriptor.",
        source_catalog: CATALOG_REL,
        total_images: index.reduce((a, f) => a + f.image_count, 0),
        conventions: {
          units: "mm",
          up_axis: "Y",
          forward_axis: "-Z",
          origin: "Midpoint of the bridge on the front face of the frame",
          confidence_levels: {
            supplier_published: "Copied from the supplier catalog.",
            observed_in_photos: "Read off the reference photos by eye.",
            estimated: "Computed from supplier data by a stated formula.",
            heuristic: "Typical value for this construction type. Not measured. Do not treat as spec.",
          },
        },
        image_note:
          "One photo per colourway is everything the supplier has. All of a model's photos share the same three-quarter angle (SL906 is the exception: its single JPEG holds a three-quarter and a front shot), so extra colourways give texture variation, not parallax.",
        frames: index,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`\n${index.length} frames, ${downloaded} images downloaded, ${cached} cached -> ${HERE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
