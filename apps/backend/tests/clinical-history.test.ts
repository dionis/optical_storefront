import { cleanHistory, summarizeHistory, clinicalSummaryOf, HISTORY_TEXT_MAX } from "../src/lib/clinical-history";
import { cleanClinical } from "../src/lib/visual-acuity";

/**
 * Case history on a prescription and the patient's history (owner, 19-nov-2026):
 * conditions from a fixed list, family history, medications, allergies and the
 * doctor's notes; and the history across visits.
 */
describe("clinical history", () => {
  it("cleans codes in list order, without repeats, and trims the texts", () => {
    expect(cleanHistory({ conditions: ["glaucoma", "diabetes", "glaucoma"], family: ["amd"], medications: "  Metformina 850 mg ", allergies: "", notes: " Control de PIO cada 6 meses \r\n" })).toEqual({
      conditions: ["diabetes", "glaucoma"],
      family: ["amd"],
      medications: "Metformina 850 mg",
      allergies: "",
      notes: "Control de PIO cada 6 meses",
    });
  });

  it("nothing given is null; unknown codes and long texts are refused with the field", () => {
    expect(cleanHistory(null)).toBeNull();
    expect(cleanHistory({ conditions: [], family: [], notes: "   " })).toBeNull();
    expect(cleanHistory({ conditions: ["cancer"] })).toEqual({ reason: "history_invalid", field: "conditions" });
    expect(cleanHistory({ family: ["dry_eye"] })).toEqual({ reason: "history_invalid", field: "family" });
    expect(cleanHistory({ notes: "x".repeat(HISTORY_TEXT_MAX.notes + 1) })).toEqual({ reason: "history_invalid", field: "notes" });
    expect(cleanHistory({ medications: 12 })).toEqual({ reason: "history_invalid", field: "medications" });
    expect(cleanHistory("diabetico")).toEqual({ reason: "history_invalid" });
  });

  it("travels inside the clinical record: notes alone are enough to keep it", () => {
    const c = cleanClinical({ va: {}, dominant_eye: null, history: { notes: "Paciente diabético tipo 2" } });
    expect(c && !("reason" in c) && c.history?.notes).toBe("Paciente diabético tipo 2");
    expect(cleanClinical({ va: { sc: { od: "20/40" } }, history: { conditions: ["xx"] } })).toEqual({ reason: "history_invalid", field: "conditions" });
    const vaOnly = cleanClinical({ va: { sc: { od: "20/40" } } });
    expect(vaOnly && !("reason" in vaOnly) && vaOnly.history).toBeUndefined();
  });

  it("the patient's history across visits: first/last noted, current, latest texts, notes newest first", () => {
    const s = summarizeHistory([
      { rx_id: "a", rx_number: "RX-1", date: "2025-03-01", history: { conditions: ["diabetes", "dry_eye"], family: ["glaucoma"], medications: "Metformina", allergies: "Penicilina", notes: "Primera visita" } },
      { rx_id: "b", rx_number: "RX-2", date: "2025-09-10", history: null },
      { rx_id: "c", rx_number: "RX-3", date: "2026-10-05", history: { conditions: ["diabetes", "glaucoma_suspect"], family: [], medications: "Metformina + insulina", allergies: "", notes: "Fondo de ojo: sin retinopatía" } },
    ]);
    expect(s.visits).toBe(2);
    expect(s.conditions).toEqual([
      { code: "diabetes", first: "2025-03-01", last: "2026-10-05", current: true },
      { code: "glaucoma_suspect", first: "2026-10-05", last: "2026-10-05", current: true },
      { code: "dry_eye", first: "2025-03-01", last: "2025-03-01", current: false },
    ]);
    expect(s.family).toEqual([{ code: "glaucoma", first: "2025-03-01" }]);
    expect(s.medications).toEqual({ text: "Metformina + insulina", date: "2026-10-05" });
    expect(s.allergies).toEqual({ text: "Penicilina", date: "2025-03-01" });
    expect(s.notes.map((n) => n.rx_number)).toEqual(["RX-3", "RX-1"]);
    expect(s.latest?.conditions).toEqual(["diabetes", "glaucoma_suspect"]);
  });

  it("from stored prescriptions: the ones they arrived with carry no exam; no history = empty", () => {
    const s = clinicalSummaryOf([
      { id: "w", kind: "worn", rx_number: null, rx_date: "2024-01-01", created_at: "2024-01-01T00:00:00Z", clinical: { history: { conditions: ["glaucoma"], family: [], medications: "", allergies: "", notes: "" } } },
      { id: "n", kind: "new", rx_number: "RX-9", rx_date: null, created_at: "2026-11-19T15:00:00Z", clinical: null },
    ]);
    expect(s).toMatchObject({ conditions: [], family: [], notes: [], latest: null, visits: 0, medications: null });
  });
});
