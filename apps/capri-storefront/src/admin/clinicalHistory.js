// Antecedentes clínicos de la receta y la historia del paciente (copia del
// backend apps/backend/src/lib/clinical-history.ts; mismos casos en
// scripts/test-clinical-history.mjs). Dueño, 19-nov-2026: «un campo de notas
// para que el doctor escriba que el paciente es diabético, tiene glaucoma… y la
// historia por paciente, según estándares ópticos» (anamnesis del examen visual
// completo: AOA 2023 / AAO PPP).

export const SYSTEMIC_CONDITIONS = ["diabetes", "hypertension", "thyroid", "autoimmune", "migraine", "pregnancy", "steroids"];
export const OCULAR_CONDITIONS = ["glaucoma", "glaucoma_suspect", "cataract", "pseudophakia", "amd", "diabetic_retinopathy", "retinal_detachment", "keratoconus", "dry_eye", "amblyopia", "strabismus", "refractive_surgery", "contact_lenses", "eye_injury"];
export const FAMILY_CONDITIONS = ["glaucoma", "amd", "diabetes", "retinal_detachment", "keratoconus", "strabismus", "blindness"];
export const CONDITIONS = [...SYSTEMIC_CONDITIONS, ...OCULAR_CONDITIONS];
export const HISTORY_TEXT_MAX = { medications: 300, allergies: 200, notes: 1000 };

/** Condiciones que piden un recordatorio clínico en pantalla (clave adm.ch.alert.<código>). */
export const ALERT_CONDITIONS = ["diabetes", "diabetic_retinopathy", "glaucoma", "glaucoma_suspect", "steroids", "pregnancy", "keratoconus", "amd"];
export const ALERT_FAMILY = ["glaucoma", "amd"];

export const EMPTY_HISTORY = { conditions: [], family: [], medications: "", allergies: "", notes: "" };

export const isEmptyHistory = (h) => !h || (!h.conditions?.length && !h.family?.length && !(h.medications || "").trim() && !(h.allergies || "").trim() && !(h.notes || "").trim());

/** El campo que se pasa de largo («notes»…), o null. */
export function historyProblem(h) {
  if (!h) return null;
  for (const k of ["medications", "allergies", "notes"]) if ((h[k] || "").trim().length > HISTORY_TEXT_MAX[k]) return k;
  return null;
}

/** Lo que viaja al servidor: null cuando no se anotó nada. */
export function historyBody(h) {
  if (!h || isEmptyHistory(h) || historyProblem(h)) return null;
  const set = (list, all) => all.filter((c) => (list || []).includes(c));
  return { conditions: set(h.conditions, CONDITIONS), family: set(h.family, FAMILY_CONDITIONS), medications: (h.medications || "").trim(), allergies: (h.allergies || "").trim(), notes: (h.notes || "").replace(/\r\n/g, "\n").trim() };
}

/** Lo guardado → el formulario. */
export const historyForm = (h) => (h ? { conditions: [...(h.conditions || [])], family: [...(h.family || [])], medications: h.medications || "", allergies: h.allergies || "", notes: h.notes || "" } : { ...EMPTY_HISTORY, conditions: [], family: [] });

/** Recordatorios clínicos de una historia (claves del diccionario), sin repetir. */
export function historyAlerts(h) {
  if (!h) return [];
  const out = [];
  for (const c of ALERT_CONDITIONS) if ((h.conditions || []).includes(c)) out.push(`adm.ch.alert.${c}`);
  for (const f of ALERT_FAMILY) if ((h.family || []).includes(f) && !out.includes(`adm.ch.alert.family_${f}`)) out.push(`adm.ch.alert.family_${f}`);
  return out;
}
