// Copia del panel de los antecedentes clínicos (src/admin/clinicalHistory.js) frente a los casos del backend.
import assert from "node:assert/strict";
import { historyBody, historyForm, historyProblem, isEmptyHistory, historyAlerts, HISTORY_TEXT_MAX, CONDITIONS, FAMILY_CONDITIONS } from "../src/admin/clinicalHistory.js";

assert.deepEqual(historyBody({ conditions: ["glaucoma", "diabetes", "glaucoma"], family: ["amd"], medications: "  Metformina 850 mg ", allergies: "", notes: " Control de PIO cada 6 meses \r\n" }), {
  conditions: ["diabetes", "glaucoma"], family: ["amd"], medications: "Metformina 850 mg", allergies: "", notes: "Control de PIO cada 6 meses",
});
assert.equal(historyBody({ conditions: [], family: [], notes: "  " }), null);
assert.equal(isEmptyHistory(null), true);
assert.equal(historyProblem({ notes: "x".repeat(HISTORY_TEXT_MAX.notes + 1) }), "notes");
assert.equal(historyBody({ notes: "x".repeat(HISTORY_TEXT_MAX.notes + 1) }), null);
assert.deepEqual(historyForm(null), { conditions: [], family: [], medications: "", allergies: "", notes: "" });
assert.deepEqual(historyAlerts({ conditions: ["diabetes", "glaucoma"], family: ["glaucoma"] }), ["adm.ch.alert.diabetes", "adm.ch.alert.glaucoma", "adm.ch.alert.family_glaucoma"]);
// Mismas listas que el backend.
assert.equal(CONDITIONS.length, 21);
assert.equal(FAMILY_CONDITIONS.length, 7);
console.log("clinical history ok");
