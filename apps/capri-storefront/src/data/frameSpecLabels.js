// Turns the frame attributes stored on a product back into words.
//
// The backend sends raw slugs ("cat-eye", "full-frame", "injection-2") for the
// same reason it sends lens codes: a slug is stable and language-neutral, and
// the shopper's language is only known in the browser. Same fallback rule as
// lensLabels.js — an unrecognised slug renders as itself, never blank.
import { L } from "./lensPricing.js";

const SHAPE = {
  square: { es: "Cuadrado", en: "Square" },
  round: { es: "Redondo", en: "Round" },
  "cat-eye": { es: "Ojo de gato", en: "Cat eye" },
  navigator: { es: "Navegador", en: "Navigator" },
  rectangle: { es: "Rectángulo", en: "Rectangle" },
  aviator: { es: "Aviador", en: "Aviator" },
  geometric: { es: "Geométrico", en: "Geometric" },
  oval: { es: "Oval", en: "Oval" },
  "modified-oval": { es: "Óvalo modificado", en: "Modified oval" },
  "modified-round": { es: "Ronda modificada", en: "Modified round" },
  combo: { es: "Combo", en: "Combo" },
  "full-frame": { es: "Marco completo", en: "Full frame" },
};

// Rim construction, not the outline. `full-rim` and `full-frame` are the same
// thing under two supplier spellings.
const STYLE = {
  "full-frame": { es: "Marco completo", en: "Full rim" },
  "full-rim": { es: "Marco completo", en: "Full rim" },
  combo: { es: "Combinado", en: "Combo" },
  "semi-rimless": { es: "Semi al aire", en: "Semi-rimless" },
  "3-piece-rimless": { es: "Al aire (3 piezas)", en: "3-piece rimless" },
  rimless: { es: "Al aire", en: "Rimless" },
  wireless: { es: "Sin alambre", en: "Wireless" },
  sunglasses: { es: "Gafas de sol", en: "Sunglasses" },
};

// `injection-2` is a supplier code for the same injected plastic as `injection`.
const MATERIAL = {
  acetate: { es: "Acetato", en: "Acetate" },
  plastic: { es: "Plástica", en: "Plastic" },
  metal: { es: "Metal", en: "Metal" },
  "stainless-steel": { es: "Acero inoxidable", en: "Stainless steel" },
  memory: { es: "Memoria", en: "Memory metal" },
  titanium: { es: "Titanio", en: "Titanium" },
  injection: { es: "Inyección", en: "Injection" },
  "injection-2": { es: "Inyección", en: "Injection" },
  tr90: { es: "TR-90", en: "TR-90" },
  ultem: { es: "Ultem", en: "Ultem" },
};

const GENDER = {
  men: { es: "Hombres", en: "Men" },
  women: { es: "Señoras", en: "Women" },
  unisex: { es: "Unisexo", en: "Unisex" },
  kids: { es: "Niños", en: "Kids" },
};

const AGE = {
  adult: { es: "Adulto", en: "Adult" },
  kids: { es: "Niños", en: "Kids" },
};

function labelFor(table, slug, lang) {
  if (!slug) return null;
  const hit = table[String(slug).toLowerCase()];
  return hit ? L(hit, lang) || slug : slug;
}

/** Optical shorthand every optician reads at a glance: 52□16-140. */
export function frameSize(frame) {
  if (!frame) return null;
  const { eye_size: eye, bridge_size: bridge, temple_length: temple } = frame;
  if (eye != null && bridge != null && temple != null) return `${eye}□${bridge}-${temple}`;
  if (eye != null) return `${eye} mm`;
  return null;
}

/**
 * The frame's technical sheet as labelled rows, ready to render. Returns [] when
 * the product has no scraped attributes, so callers can skip the whole block.
 */
export function frameSpecRows(frame, lang, t) {
  if (!frame) return [];
  const mm = (v) => (v == null ? null : `${v} mm`);
  const rows = [
    ["sku", t("orders.frameSku"), frame.sku],
    ["size", t("orders.frameSize"), frameSize(frame)],
    ["lensWidth", t("orders.frameLensWidth"), mm(frame.lens_width)],
    ["lensHeight", t("orders.frameLensHeight"), mm(frame.lens_height)],
    ["bridge", t("orders.frameBridge"), mm(frame.bridge_size)],
    ["temple", t("orders.frameTemple"), mm(frame.temple_length)],
    ["shape", t("orders.frameShape"), labelFor(SHAPE, frame.shape, lang)],
    ["style", t("orders.frameStyle"), labelFor(STYLE, frame.style, lang)],
    ["material", t("orders.frameMaterial"), labelFor(MATERIAL, frame.material, lang)],
    ["gender", t("orders.frameGender"), labelFor(GENDER, frame.gender, lang)],
    ["age", t("orders.frameAge"), labelFor(AGE, frame.age_group, lang)],
    [
      "features",
      t("orders.frameFeatures"),
      frame.features && frame.features.length ? frame.features.join(", ") : null,
    ],
  ];
  return rows
    .filter(([, , value]) => value != null && value !== "")
    .map(([key, label, value]) => ({ key, label, value }));
}
