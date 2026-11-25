// Presentation facts about a lens material for the web material chooser
// (components/MaterialChooser.jsx). Pure: no prose here, only codes and numbers —
// the component turns them into `lens.mx.*` dictionary keys.
//
// The materials themselves (which exist, their labels and prices) come from the
// owner's lens matrix; this module only knows the PHYSICS of a material code:
// its refractive index and, from it, how thick the lens ends up.

const KNOWN_INDEX = { cr39: 1.5, poly: 1.59 };

/** Refractive index of a material code. Numeric codes ("1.67") are their own index. */
export function refractiveIndex(code) {
  const known = KNOWN_INDEX[code];
  if (known != null) return known;
  const n = Number.parseFloat(code);
  return Number.isFinite(n) && n > 1 && n < 2.2 ? n : null;
}

/** "1.50", "1.59", "1.67" — two decimals, as opticians write it. Null when unknown. */
export function indexLabel(code) {
  const n = refractiveIndex(code);
  return n == null ? null : n.toFixed(2);
}

/**
 * The family a material belongs to, which decides its copy and its drawing:
 * cr39 · poly · mid (1.53–1.64) · high (1.65–1.70) · ultra (≥ 1.71).
 * An unknown code is described as standard resin rather than left blank.
 */
export function materialKind(code) {
  if (code === "cr39") return "cr39";
  if (code === "poly") return "poly";
  const n = refractiveIndex(code);
  if (n == null) return "cr39";
  if (n >= 1.71) return "ultra";
  if (n >= 1.65) return "high";
  if (n >= 1.53) return "mid";
  return "cr39";
}

/**
 * Relative edge thickness for the drawings, 1 = standard resin. Follows the
 * usual rule of thumb: thickness shrinks with (n − 1), so 1.67 is ~25 % thinner
 * than 1.50. Clamped so a drawing never collapses to a line.
 */
export function relativeThickness(code) {
  const n = refractiveIndex(code) ?? 1.5;
  return Math.max(0.42, Math.min(1, 0.5 / (n - 1)));
}

/**
 * The tag shown next to each material in the list. Derived from the list the
 * shop actually offers, so it never claims something the prices contradict:
 *   cheapest  — the single lowest price
 *   tough     — polycarbonate
 *   thinnest  — the highest index on offer (when it is a thin material at all)
 *   thin      — any other index above standard resin
 *   clear     — standard resin when it is not the cheapest
 * `materials` is [{ id }], `priceOf(id)` the price shown for the chosen design.
 */
export function materialTags(materials, priceOf) {
  const prices = materials.map((m) => Number(priceOf(m.id)));
  const valid = prices.filter((p) => Number.isFinite(p));
  const min = valid.length ? Math.min(...valid) : null;
  const cheapestCount = prices.filter((p) => p === min).length;
  let thinnest = null;
  for (const m of materials) {
    const n = refractiveIndex(m.id);
    if (n != null && n >= 1.6 && (thinnest == null || n > thinnest.n)) thinnest = { id: m.id, n };
  }
  const out = {};
  materials.forEach((m, i) => {
    const kind = materialKind(m.id);
    if (min != null && prices[i] === min && cheapestCount === 1) out[m.id] = "cheapest";
    else if (kind === "poly") out[m.id] = "tough";
    else if (thinnest && thinnest.id === m.id) out[m.id] = "thinnest";
    else if (kind === "cr39") out[m.id] = "clear";
    else out[m.id] = "thin";
  });
  return out;
}

/** True when a bifocal design is the flat-top 28 the drawing shows. */
export function isFlatTop28(design) {
  if (!design) return false;
  const text = `${design.id || ""} ${design.label?.es || ""} ${design.label?.en || ""}`;
  return design.id === "bifocal" || /ft[\s-]?28|flat[\s-]?top/i.test(text);
}
