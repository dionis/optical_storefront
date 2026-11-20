/**
 * VISUAL ACUITY AND DOMINANT EYE on a prescription (owner, 18-nov-2026: «la
 * receta debe tener la agudeza visual bajo los estándares optométricos: con
 * cristales y sin cristales, por ojo … y el ojo dominante, fácil de insertar»).
 * Pure; the panel has a copy (apps/capri-storefront/src/admin/visualAcuity.js,
 * same cases in scripts/test-visual-acuity.mjs).
 *
 * The standard: distance acuity in Snellen notation at 20 ft (US), with the
 * line modifier for letters missed or read on the next line («20/100-2» = the
 * 20/100 line with 2 letters missed), as on the store's paper form, and the
 * low-vision categories below the chart (ICO / ANSI Z80 usage): CF (counts
 * fingers — «CD, cuenta dedos»), HM (hand motion — «MM, movimiento de
 * manos»), LP (light perception — «PL»), NLP (no light perception — «NPL»).
 * Metric 6/x and decimal entries are converted to the 20-ft line. Each value
 * also has its logMAR (log10 of the denominator / 20, −0.02 per letter
 * read beyond, +0.02 per letter missed; CF 1.9, HM 2.3, LP 2.7, NLP 3.0 by the
 * usual convention), so «how much better with glasses» is a number of lines.
 *
 * Stored on the prescription (`prescription.clinical`, migration
 * CreatePrescription4Clinical): { va: { sc: { od, os, ou }, cc: { od, os, ou } },
 * dominant_eye: "od" | "os" | null, history? } (history: lib/clinical-history.ts).
 * sc = sin corrección (without glasses),
 * cc = con corrección (with this prescription). Everything is optional.
 */

import { cleanHistory, isEmptyHistory, type ClinicalHistory } from "./clinical-history";

/** The Snellen lines of a standard 20-ft chart (denominators). */
export const SNELLEN_LINES = [10, 12.5, 15, 16, 20, 25, 30, 32, 40, 50, 60, 63, 70, 80, 100, 125, 160, 200, 250, 320, 400, 500, 800] as const;
export const LOW_VISION = ["CF", "HM", "LP", "NLP"] as const;
export type LowVision = (typeof LOW_VISION)[number];
const LOW_LOGMAR: Record<LowVision, number> = { CF: 1.9, HM: 2.3, LP: 2.7, NLP: 3.0 };
/** Spanish abbreviations the store writes, and their standard code. */
const LOW_ALIASES: Record<string, LowVision> = { CF: "CF", CD: "CF", HM: "HM", MM: "HM", MDM: "HM", LP: "LP", PL: "LP", PPL: "LP", NLP: "NLP", NPL: "NLP", SPL: "NLP" };

const METRIC_TO_FEET = 20 / 6;

/** The nearest standard line to a denominator (in feet). */
function nearestLine(den: number): number {
  let best: number = SNELLEN_LINES[0];
  for (const l of SNELLEN_LINES) if (Math.abs(Math.log(l / den)) < Math.abs(Math.log(best / den))) best = l;
  return best;
}

const fmtDen = (d: number) => (Number.isInteger(d) ? String(d) : String(d));

/**
 * One acuity as typed («20/40», «40», «20/100-2», «100 -2», «6/12», «0.5»,
 * «cd», «PL») → its canonical form («20/40», «20/100-2», «20/40», «20/40»,
 * «CF», «LP»), "" when empty, or null when it is not an acuity.
 */
export function normalizeVa(raw: unknown): string | null {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "").replace(/−/g, "-");
  if (!s) return "";
  if (LOW_ALIASES[s]) return LOW_ALIASES[s];
  // 20/x[±n] or x[±n] (the 20/ is implied, as on most forms)
  let m = /^(?:20\/)?(\d{1,3}(?:\.5)?)([+-][1-5])?$/.exec(s);
  if (m) {
    const den = Number(m[1]);
    // Not a chart line: maybe a decimal acuity («0.5»), tried below.
    if (SNELLEN_LINES.includes(den as never)) return `20/${fmtDen(den)}${m[2] ?? ""}`;
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
export function vaLogMar(va: string | null | undefined): number | null {
  if (!va) return null;
  if ((LOW_VISION as readonly string[]).includes(va)) return LOW_LOGMAR[va as LowVision];
  const m = /^20\/(\d{1,3}(?:\.5)?)([+-][1-5])?$/.exec(va);
  if (!m) return null;
  const base = Math.log10(Number(m[1]) / 20);
  const mod = m[2] ? Number(m[2]) : 0; // «-2» = 2 letters missed (worse), «+1» = 1 letter of the next line (better)
  return Math.round((base - 0.02 * mod) * 100) / 100;
}

export type Eye = "od" | "os";
export interface VaSet { od: string; os: string; ou: string }
export interface Clinical {
  va: { sc: VaSet; cc: VaSet };
  dominant_eye: Eye | null;
  /** Case history and the examiner's notes (lib/clinical-history.ts); absent/null = none. */
  history?: ClinicalHistory | null;
}

const EMPTY_SET = (): VaSet => ({ od: "", os: "", ou: "" });

export const isEmptyClinical = (c: Clinical | null | undefined): boolean =>
  !c || (!c.dominant_eye && isEmptyHistory(c.history) && ["sc", "cc"].every((k) => ["od", "os", "ou"].every((e) => !c.va[k as "sc" | "cc"][e as keyof VaSet])));

/**
 * The till's `{ va: { sc: {od, os, ou}, cc: {…} }, dominant_eye }` → the
 * clean value (null when nothing was given), or the field that is wrong
 * (`va_invalid` with `field`: "sc.od", …; `dominant_eye_invalid`).
 */
export function cleanClinical(input: unknown): Clinical | null | { reason: "va_invalid" | "dominant_eye_invalid" | "history_invalid"; field?: string } {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input !== "object") return { reason: "va_invalid" };
  const o = input as Record<string, unknown>;
  const va = (o.va && typeof o.va === "object" ? o.va : {}) as Record<string, unknown>;
  const out: Clinical = { va: { sc: EMPTY_SET(), cc: EMPTY_SET() }, dominant_eye: null };
  for (const k of ["sc", "cc"] as const) {
    const set = (va[k] && typeof va[k] === "object" ? va[k] : {}) as Record<string, unknown>;
    for (const e of ["od", "os", "ou"] as const) {
      const v = normalizeVa(set[e]);
      if (v === null) return { reason: "va_invalid", field: `${k}.${e}` };
      out.va[k][e] = v;
    }
  }
  const d = o.dominant_eye;
  if (d !== undefined && d !== null && d !== "") {
    if (d !== "od" && d !== "os") return { reason: "dominant_eye_invalid" };
    out.dominant_eye = d;
  }
  const h = cleanHistory(o.history);
  if (h && "reason" in h) return h;
  if (h) out.history = h;
  return isEmptyClinical(out) ? null : out;
}

/**
 * Lines gained with the correction, per eye and both (logMAR sc − cc, in
 * tenths: 7 = seven lines). null where either side is missing.
 */
export function linesGained(c: Clinical | null | undefined): { od: number | null; os: number | null; ou: number | null } {
  const g = (e: keyof VaSet) => {
    const a = vaLogMar(c?.va.sc[e]);
    const b = vaLogMar(c?.va.cc[e]);
    return a === null || b === null ? null : Math.round((a - b) * 10);
  };
  return { od: g("od"), os: g("os"), ou: g("ou") };
}
