// The panel's copy of the acuity rules (src/admin/visualAcuity.js) must answer
// like the server's (backend src/lib/visual-acuity.ts, tests/visual-acuity.test.ts).
import assert from "node:assert/strict";
import { clinicalBody, clinicalProblem, linesGained, normalizeVa, vaLogMar, EMPTY_CLINICAL } from "../src/admin/visualAcuity.js";

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };
check("normalize", () => {
  const cases = [["20/20", "20/20"], ["20", "20/20"], ["40", "20/40"], ["100-2", "20/100-2"], ["20/100 -2", "20/100-2"], ["20/25+1", "20/25+1"], ["6/6", "20/20"], ["6/12", "20/40"], ["0.5", "20/40"], ["1", "20/20"], ["cd", "CF"], ["MM", "HM"], ["pl", "LP"], ["NPL", "NLP"], ["", ""], ["20/33", null], ["abc", null], ["20/100-9", null]];
  for (const [raw, want] of cases) assert.deepEqual([raw, normalizeVa(raw)], [raw, want]);
});
check("logMAR", () => { assert.equal(vaLogMar("20/20"), 0); assert.equal(vaLogMar("20/25"), 0.1); assert.equal(vaLogMar("20/100-2"), 0.74); assert.equal(vaLogMar("CF"), 1.9); });
check("body and problems", () => {
  const f = { va: { sc: { od: "100-2", os: "100-2", ou: "" }, cc: { od: "20", os: "20", ou: "20" } }, dominant_eye: "od" };
  assert.deepEqual(clinicalBody(f), { va: { sc: { od: "20/100-2", os: "20/100-2", ou: "" }, cc: { od: "20/20", os: "20/20", ou: "20/20" } }, dominant_eye: "od" });
  assert.equal(clinicalBody(EMPTY_CLINICAL), null);
  assert.equal(clinicalProblem({ ...EMPTY_CLINICAL, va: { ...EMPTY_CLINICAL.va, cc: { od: "", os: "20/33", ou: "" } } }), "cc.os");
  assert.deepEqual(linesGained(clinicalBody(f)), { od: 7, os: 7, ou: null });
});
console.log(`${n} passed`);
