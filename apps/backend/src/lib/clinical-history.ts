/**
 * CLINICAL HISTORY ON A PRESCRIPTION, AND THE PATIENT'S HISTORY (owner,
 * 19-nov-2026: «al insertar la receta, un campo de notas para que el doctor
 * escriba que el paciente es diabético, tiene glaucoma, etc., y tener la
 * historia por paciente … piensa en estándares ópticos»). Pure; the panel has
 * a copy (apps/capri-storefront/src/admin/clinicalHistory.js, same cases in
 * scripts/test-clinical-history.mjs).
 *
 * The standard: the case history of a comprehensive eye examination (AOA
 * Evidence-Based Clinical Practice Guideline «Comprehensive Adult Eye and
 * Vision Examination», 2nd ed. 2023; AAO Preferred Practice Pattern
 * «Comprehensive Adult Medical Eye Evaluation»): general health conditions
 * that affect the eye, ocular history, current medications, allergies and
 * family ocular/medical history, plus the examiner's notes. The conditions are
 * a fixed list (codes, so they can be counted and translated); everything else
 * is short free text.
 *
 * Stored inside the prescription's clinical record (`prescription.clinical.history`,
 * the column of CreatePrescription4Clinical — no new migration):
 *   { conditions: string[], family: string[], medications, allergies, notes }
 * Health data: the operation log keeps it as «[health data]» (oplog_clean),
 * it never goes to receipts, emails, the Sheet, the lab ticket or the search.
 */

/** General health conditions with ocular relevance. */
export const SYSTEMIC_CONDITIONS = ["diabetes", "hypertension", "thyroid", "autoimmune", "migraine", "pregnancy", "steroids"] as const;
/** Ocular history. */
export const OCULAR_CONDITIONS = [
  "glaucoma",
  "glaucoma_suspect",
  "cataract",
  "pseudophakia",
  "amd",
  "diabetic_retinopathy",
  "retinal_detachment",
  "keratoconus",
  "dry_eye",
  "amblyopia",
  "strabismus",
  "refractive_surgery",
  "contact_lenses",
  "eye_injury",
] as const;
/** Family history the examiner asks for. */
export const FAMILY_CONDITIONS = ["glaucoma", "amd", "diabetes", "retinal_detachment", "keratoconus", "strabismus", "blindness"] as const;

export const CONDITIONS = [...SYSTEMIC_CONDITIONS, ...OCULAR_CONDITIONS] as const;
export type Condition = (typeof CONDITIONS)[number];
export type FamilyCondition = (typeof FAMILY_CONDITIONS)[number];

export const HISTORY_TEXT_MAX = { medications: 300, allergies: 200, notes: 1000 } as const;

export interface ClinicalHistory {
  conditions: Condition[];
  family: FamilyCondition[];
  medications: string;
  allergies: string;
  notes: string;
}

export const EMPTY_HISTORY = (): ClinicalHistory => ({ conditions: [], family: [], medications: "", allergies: "", notes: "" });

export const isEmptyHistory = (h: ClinicalHistory | null | undefined): boolean =>
  !h || (!h.conditions.length && !h.family.length && !h.medications && !h.allergies && !h.notes);

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

/**
 * The till's history → clean (codes in the list order, no repeats; texts
 * trimmed), null when nothing was given, or what is wrong
 * (`history_invalid` with `field`: "conditions", "family", "notes"…).
 */
export function cleanHistory(input: unknown): ClinicalHistory | null | { reason: "history_invalid"; field?: string } {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input !== "object" || Array.isArray(input)) return { reason: "history_invalid" };
  const o = input as Record<string, unknown>;
  const out = EMPTY_HISTORY();
  for (const [key, list] of [["conditions", CONDITIONS], ["family", FAMILY_CONDITIONS]] as const) {
    const raw = o[key];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) return { reason: "history_invalid", field: key };
    const set = new Set<string>();
    for (const c of raw) {
      if (typeof c !== "string" || !(list as readonly string[]).includes(c)) return { reason: "history_invalid", field: key };
      set.add(c);
    }
    (out[key] as string[]) = (list as readonly string[]).filter((c) => set.has(c));
  }
  for (const key of ["medications", "allergies", "notes"] as const) {
    const raw = o[key];
    if (raw !== undefined && raw !== null && typeof raw !== "string") return { reason: "history_invalid", field: key };
    const v = text(raw);
    if (v.length > HISTORY_TEXT_MAX[key]) return { reason: "history_invalid", field: key };
    out[key] = v;
  }
  return isEmptyHistory(out) ? null : out;
}

/** One prescription of the patient, as the summary reads it. */
export interface HistoryVisit {
  rx_id: string;
  rx_number: string | null;
  /** The prescription's date, else the day it was recorded (YYYY-MM-DD). */
  date: string;
  history: ClinicalHistory | null;
}

export interface PatientClinicalSummary {
  /** Every condition ever noted, with the first and last visit it was noted at. */
  conditions: Array<{ code: Condition; first: string; last: string; current: boolean }>;
  family: Array<{ code: FamilyCondition; first: string }>;
  /** The latest medications / allergies written (and when). */
  medications: { text: string; date: string } | null;
  allergies: { text: string; date: string } | null;
  /** Every examiner's note, newest first. */
  notes: Array<{ date: string; rx_number: string | null; text: string }>;
  /** The latest history written, to start the next prescription from (the doctor confirms it). */
  latest: ClinicalHistory | null;
  visits: number;
}

/**
 * The patient's clinical history across their prescriptions (oldest first in,
 * any order works): a condition noted once stays in the history with its dates;
 * «current» = noted at the latest visit that recorded a history.
 */
export function summarizeHistory(visits: readonly HistoryVisit[]): PatientClinicalSummary {
  const sorted = [...visits].filter((v) => v.history && !isEmptyHistory(v.history)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const cond = new Map<Condition, { first: string; last: string }>();
  const fam = new Map<FamilyCondition, string>();
  let medications: PatientClinicalSummary["medications"] = null;
  let allergies: PatientClinicalSummary["allergies"] = null;
  const notes: PatientClinicalSummary["notes"] = [];
  for (const v of sorted) {
    const h = v.history as ClinicalHistory;
    for (const c of h.conditions) {
      const cur = cond.get(c);
      cond.set(c, { first: cur?.first ?? v.date, last: v.date });
    }
    for (const f of h.family) if (!fam.has(f)) fam.set(f, v.date);
    if (h.medications) medications = { text: h.medications, date: v.date };
    if (h.allergies) allergies = { text: h.allergies, date: v.date };
    if (h.notes) notes.push({ date: v.date, rx_number: v.rx_number, text: h.notes });
  }
  const latest = sorted.length ? (sorted[sorted.length - 1].history as ClinicalHistory) : null;
  const lastDate = sorted.length ? sorted[sorted.length - 1].date : null;
  return {
    conditions: CONDITIONS.filter((c) => cond.has(c)).map((c) => ({ code: c, ...(cond.get(c) as { first: string; last: string }), current: cond.get(c)!.last === lastDate })),
    family: FAMILY_CONDITIONS.filter((f) => fam.has(f)).map((f) => ({ code: f, first: fam.get(f) as string })),
    medications,
    allergies,
    notes: notes.reverse(),
    latest,
    visits: sorted.length,
  };
}

/** The summary of a patient's prescriptions as the history lists them (StoredRx-like rows; the worn ones carry no exam). */
export const clinicalSummaryOf = (rows: ReadonlyArray<{ id: string; kind: string | null; rx_number: string | null; rx_date: string | null; created_at: string; clinical: { history?: ClinicalHistory | null } | null }>): PatientClinicalSummary =>
  summarizeHistory(rows.filter((h) => h.kind !== "worn").map((h) => ({ rx_id: h.id, rx_number: h.rx_number, date: h.rx_date ?? h.created_at.slice(0, 10), history: h.clinical?.history ?? null })));
