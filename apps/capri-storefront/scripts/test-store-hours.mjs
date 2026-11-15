// The panel's copy of the opening-hours logic (src/admin/storeHours.js) must
// answer like the server's (backend src/lib/store-hours.ts, tests/store-hours-promotions.test.ts).
import assert from "node:assert/strict";
import { DEFAULT_HOURS, hoursStatus, localClock, problemOf, weekLine } from "../src/admin/storeHours.js";

const TZ = "America/Chicago";
let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

check("store wall clock", () => assert.deepEqual(localClock(new Date("2026-11-16T02:30:00Z"), TZ), { ymd: "2026-11-15", weekday: "sun", minutes: 1230 }));
check("open now", () => assert.deepEqual(hoursStatus(DEFAULT_HOURS, new Date("2026-11-16T16:00:00Z"), TZ).closes_at, "18:00"));
check("opens later today", () => assert.deepEqual(hoursStatus(DEFAULT_HOURS, new Date("2026-11-16T13:00:00Z"), TZ).next_open, { date: "2026-11-16", time: "09:00", today: true }));
check("weekend → Monday", () => assert.deepEqual(hoursStatus(DEFAULT_HOURS, new Date("2026-11-21T21:00:00Z"), TZ).next_open, { date: "2026-11-23", time: "09:00", today: false }));
check("special days override", () => {
  const h = { ...DEFAULT_HOURS, special: [{ date: "2026-12-24", label: "Nochebuena", closed: false, open: "09:00", close: "13:00" }, { date: "2026-12-25", label: "Navidad", closed: true, open: null, close: null }] };
  const s = hoursStatus(h, new Date("2026-12-24T20:00:00Z"), TZ);
  assert.equal(s.open, false);
  assert.deepEqual(s.next_open, { date: "2026-12-26", time: "10:00", today: false });
});
check("week line", () => assert.equal(weekLine(DEFAULT_HOURS, ["L", "M", "X", "J", "V", "S", "D"], "cerrado"), "L–V 09:00–18:00 · S 10:00–14:00 · D cerrado"));
check("unknown hours", () => assert.equal(hoursStatus(null, new Date(), TZ).known, false));
check("editor problems", () => {
  assert.equal(problemOf(DEFAULT_HOURS), null);
  assert.deepEqual(problemOf({ ...DEFAULT_HOURS, week: { ...DEFAULT_HOURS.week, fri: { open: "18:00", close: "09:00" } } }), { day: "fri" });
  assert.deepEqual(problemOf({ ...DEFAULT_HOURS, special: [{ date: "", closed: true }] }), { date: "?" });
});
console.log(`${n} passed`);
