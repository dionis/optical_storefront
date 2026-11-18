// Copia del panel de backend/src/lib/visual-acuity.ts (agudeza visual sc/cc y
// ojo dominante). Mismos casos en scripts/test-visual-acuity.mjs. El servidor
// vuelve a validar todo; aquí se normaliza al salir del campo («100-2» → «20/100-2»).
/** The Snellen lines of a standard 20-ft chart (denominators). */
export const SNELLEN_LINES = [10, 12.5, 15, 16, 20, 25, 30, 32, 40, 50, 60, 63, 70, 80, 100, 125, 160, 200, 250, 320, 400, 500, 800];
export const LOW_VISION = ["CF", "HM", "LP", "NLP"];
const LOW_LOGMAR = { CF: 1.9, HM: 2.3, LP: 2.7, NLP: 3.0 };
/** Spanish abbreviations the store writes, and their standard code. */
const LOW_ALIASES = { CF: "CF", CD: "CF", HM: "HM", MM: "HM", MDM: "HM", LP: "LP", PL: "LP", PPL: "LP", NLP: "NLP", NPL: "NLP", SPL: "NLP" };

const METRIC_TO_FEET = 20 / 6;

/** The nearest standard line to a denominator (in feet). */
function nearestLine(den) {
  let best = SNELLEN_LINES[0];
  for (const l of SNELLEN_LINES) if (Math.abs(Math.log(l / den)) < Math.abs(Math.log(best / den))) best = l;
  return best;
}

const fmtDen = (d) => (Number.isInteger(d) ? String(d) : String(d));

/**
 * One acuity as typed («20/40», «40», «20/100-2», «100 -2», «6/12», «0.5»,
 * «cd», «PL») → its canonical form («20/40», «20/100-2», «20/40», «20/40»,
 * «CF», «LP»), "" when empty, or null when it is not an acuity.
 */
export function normalizeVa(raw) {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "").replace(/−/g, "-");
  if (!s) return "";
  if (LOW_ALIASES[s]) return LOW_ALIASES[s];
  // 20/x[±n] or x[±n] (the 20/ is implied, as on most forms)
  let m = /^(?:20\/)?(\d{1,3}(?:\.5)?)([+-][1-5])?$/.exec(s);
  if (m) {
    const den = Number(m[1]);
    // Not a chart line: maybe a decimal acuity («0.5»), tried below.
    if (SNELLEN_LINES.includes(den)) return `20/${fmtDen(den)}${m[2] ?? ""}`;
  }
  // Metric 6/x → the 20-ft line
  m = /^6\/(\d{1,3}(?:\.\d)?)([+-][1-5])?$/.exec(s);
  if (m) {
    const den = Number(m[1]);
    if (!(den >= 3 && den <= 240)) return null;
    return `20/${fmtDen(nearestLine(den * METRIC_TO_FEET))}${m[2] ?? ""}`;
  }
  // Decimal 0.025–2.0 → the 20-ft line
  m = /^(\d(?:[.,]\d{1,3})?)$/.exec(s);
  if (m) {
    const dec = Number(m[1].replace(",", "."));
    if (!(dec >= 0.025 && dec <= 2)) return null;
    return `20/${fmtDen(nearestLine(20 / dec))}`;
  }
  return null;
}

/** logMAR of a canonical acuity (null for "" or unknown). Lower is better; 0.0 = 20/20; 0.1 = one line. */
export function vaLogMar(va) {
  if (!va) return null;
  if (LOW_VISION.includes(va)) return LOW_LOGMAR[va];
  const m = /^20\/(\d{1,3}(?:\.5)?)([+-][1-5])?$/.exec(va);
  if (!m) return null;
  const base = Math.log10(Number(m[1]) / 20);
  const mod = m[2] ? Number(m[2]) : 0; // «-2» = 2 letters missed (worse), «+1» = 1 letter of the next line (better)
  return Math.round((base - 0.02 * mod) * 100) / 100;
}

const EMPTY_SET = () => ({ od: "", os: "", ou: "" });

export const isEmptyClinical = (c) =>
  !c || (!c.dominant_eye && ["sc", "cc"].every((k) => ["od", "os", "ou"].every((e) => !c.va?.[k]?.[e])));

/**
 * Lines gained with the correction, per eye and both (logMAR sc − cc, in
 * tenths: 7 = seven lines). null where either side is missing.
 */
export function linesGained(c) {
  const g = (e) => {
    const a = vaLogMar(c?.va.sc[e]);
    const b = vaLogMar(c?.va.cc[e]);
    return a === null || b === null ? null : Math.round((a - b) * 10);
  };
  return { od: g("od"), os: g("os"), ou: g("ou") };
}

export const EMPTY_CLINICAL = { va: { sc: { od: "", os: "", ou: "" }, cc: { od: "", os: "", ou: "" } }, dominant_eye: null };
/** Las sugerencias del campo (las líneas más usadas y los códigos de baja visión, en español). */
export const VA_SUGGEST = ["20/15", "20/20", "20/25", "20/30", "20/40", "20/50", "20/60", "20/70", "20/80", "20/100", "20/200", "20/400", "CF", "HM", "LP", "NLP"];
/** El campo que no es una agudeza («sc.od»…), o null. */
export function clinicalProblem(c) {
  for (const k of ["sc", "cc"]) for (const e of ["od", "os", "ou"]) if (normalizeVa(c?.va?.[k]?.[e]) === null) return `${k}.${e}`;
  return null;
}
/** Lo que viaja al servidor: null cuando no se anotó nada. */
export function clinicalBody(c) {
  if (!c || clinicalProblem(c) || isEmptyClinical(c)) return null;
  const n = (v) => normalizeVa(v) || "";
  return { va: { sc: { od: n(c.va.sc.od), os: n(c.va.sc.os), ou: n(c.va.sc.ou) }, cc: { od: n(c.va.cc.od), os: n(c.va.cc.os), ou: n(c.va.cc.ou) } }, dominant_eye: c.dominant_eye || null };
}
/** Lo guardado → el formulario. */
export const clinicalForm = (c) => (c ? { va: { sc: { ...EMPTY_CLINICAL.va.sc, ...(c.va?.sc || {}) }, cc: { ...EMPTY_CLINICAL.va.cc, ...(c.va?.cc || {}) } }, dominant_eye: c.dominant_eye || null } : EMPTY_CLINICAL);
