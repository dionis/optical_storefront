// Horario de las tiendas en el panel: la misma lógica que el servidor
// (backend src/lib/store-hours.ts, con sus pruebas), para decir «Abierta ·
// cierra 18:00» en Tiendas, avisar en la caja fuera de horario y escribir la
// semana en una línea en los recibos. Las horas son del reloj de la tienda
// (zona horaria del negocio), no del navegador.
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DEFAULT_HOURS = {
  week: {
    mon: { open: "09:00", close: "18:00" },
    tue: { open: "09:00", close: "18:00" },
    wed: { open: "09:00", close: "18:00" },
    thu: { open: "09:00", close: "18:00" },
    fri: { open: "09:00", close: "18:00" },
    sat: { open: "10:00", close: "14:00" },
    sun: { closed: true },
  },
  special: [],
};
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function localClock(at, timeZone) {
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(at).map((p) => [p.type, p.value]));
  } catch {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(at).map((p) => [p.type, p.value]));
  }
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, weekday: String(parts.weekday).slice(0, 3).toLowerCase(), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const weekdayOf = (ymd) => WEEKDAYS[(new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7];

export function dayOf(hours, ymd) {
  const sp = (hours.special || []).find((s) => s.date === ymd) || null;
  if (sp) return { closed: sp.closed, open: sp.open, close: sp.close, special: sp };
  const d = hours.week[weekdayOf(ymd)] || { closed: true };
  return d.closed ? { closed: true, open: null, close: null, special: null } : { closed: false, open: d.open, close: d.close, special: null };
}

/** { known, open, closes_at, next_open: { date, time, today } | null, special } */
export function hoursStatus(hours, at, timeZone) {
  if (!hours || !hours.week) return { known: false, open: false, closes_at: null, next_open: null, special: null };
  const now = localClock(at, timeZone);
  const today = dayOf(hours, now.ymd);
  if (!today.closed && today.open && today.close && now.minutes >= minutes(today.open) && now.minutes < minutes(today.close)) return { known: true, open: true, closes_at: today.close, next_open: null, special: today.special };
  let next = null;
  if (!today.closed && today.open && now.minutes < minutes(today.open)) next = { date: now.ymd, time: today.open, today: true };
  for (let i = 1; !next && i <= 14; i++) {
    const ymd = addDays(now.ymd, i);
    const d = dayOf(hours, ymd);
    if (!d.closed && d.open) next = { date: ymd, time: d.open, today: false };
  }
  return { known: true, open: false, closes_at: null, next_open: next, special: today.special };
}

/** «L–V 09:00–18:00 · S 10:00–14:00 · D cerrado». `names`: días cortos, lunes primero. */
export function weekLine(hours, names, closedWord) {
  if (!hours || !hours.week) return "";
  const key = (d) => (!d || d.closed ? "closed" : `${d.open}–${d.close}`);
  const groups = [];
  WEEKDAYS.forEach((d, i) => {
    const k = key(hours.week[d]);
    const last = groups[groups.length - 1];
    if (last && last.k === k && last.to === i - 1) last.to = i;
    else groups.push({ from: i, to: i, k });
  });
  return groups.map((g) => `${g.from === g.to ? names[g.from] : `${names[g.from]}–${names[g.to]}`} ${g.k === "closed" ? closedWord : g.k}`).join(" · ");
}

/** Lo que el editor manda (null = sin horario). */
export function problemOf(hours) {
  if (!hours) return null;
  const ok = (d) => d.closed || (/^\d\d:\d\d$/.test(d.open || "") && /^\d\d:\d\d$/.test(d.close || "") && minutes(d.close) > minutes(d.open));
  for (const d of WEEKDAYS) if (!ok(hours.week[d] || {})) return { day: d };
  for (const s of hours.special || []) if (!s.date || !ok(s)) return { date: s.date || "?" };
  return null;
}
