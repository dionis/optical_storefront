// Turns the lens codes stored on an order line back into words.
//
// Line item metadata keeps codes ("sv", "1.67", "trans-s-brown",
// "ar-green-plus") because a code is stable and a label is not — the price list
// gets re-worded, orders do not get rewritten. That means anything showing a
// past order has to do the lookup itself.
//
// The lookup is against the static 2026 price list rather than the live matrix
// on purpose: an old order may reference an option the store no longer sells,
// and refetching would not resurrect it. Unknown codes fall through to the raw
// code — worse-looking than a label, but never blank and never a wrong label.
import {
  AR,
  DESIGNS,
  FRAME_ONLY,
  MATERIALS,
  PHOTO,
  L,
} from "./lensPricing.js";

const AR_ALL = [...(AR.sv || []), ...(AR.bifprog || [])];

function labelFrom(list, id, lang) {
  if (!id) return null;
  const hit = list.find((entry) => entry.id === id);
  return hit ? L(hit.label, lang) || id : id;
}

/** Human label for the lens design, including the frame-only pseudo-design. */
export function designLabel(code, lang) {
  if (!code) return null;
  if (code === FRAME_ONLY.id) return L(FRAME_ONLY.label, lang);
  return labelFrom(DESIGNS, code, lang);
}

/**
 * The configuration of one order line as labelled rows, ready to render.
 * Returns [] for a frame with no lens options, so callers can skip the block.
 */
export function lensConfigRows(lens, lang, t) {
  if (!lens) return [];
  const rows = [];
  const design = designLabel(lens.design_code, lang);
  if (design) rows.push({ key: "design", label: t("orders.lensDesign"), value: design });

  const material = labelFrom(MATERIALS, lens.material_code, lang);
  if (material) rows.push({ key: "material", label: t("orders.lensMaterial"), value: material });

  const photo = labelFrom(PHOTO, lens.photo_code, lang);
  if (photo) rows.push({ key: "photo", label: t("orders.lensPhoto"), value: photo });

  const ar = labelFrom(AR_ALL, lens.ar_code, lang);
  if (ar) rows.push({ key: "ar", label: t("orders.lensAr"), value: ar });

  return rows;
}

/** One-line summary for the collapsed view. */
export function lensSummary(lens, lang) {
  if (!lens) return "";
  return [
    designLabel(lens.design_code, lang),
    labelFrom(MATERIALS, lens.material_code, lang),
    labelFrom(PHOTO, lens.photo_code, lang),
    labelFrom(AR_ALL, lens.ar_code, lang),
  ]
    .filter(Boolean)
    .join(" · ");
}
