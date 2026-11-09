// Reglas optométricas de una receta en el punto de venta (receta nueva y la que
// el paciente usa hoy). Módulo sin hook de idioma: devuelve CLAVES (`adm.pos.rx.err.*`,
// `adm.pos.rx.warn.*`) y traduce quien pinta. El servidor
// (apps/backend/src/modules/prescription/validation.ts) repite estos rangos y es
// la última palabra; aquí solo se evita mandar lo que el laboratorio rechazaría.

/** Rango, paso y formato de cada campo. Los valores son inclusivos. */
export const RX_RULES = {
  sph: { min: -20, max: 12, step: 0.25, signed: true, decimals: 2 },
  cyl: { min: -6, max: 6, step: 0.25, signed: true, decimals: 2 },
  axis: { min: 1, max: 180, step: 1, signed: false, decimals: 0 },
  add: { min: 0.75, max: 4, step: 0.25, signed: true, decimals: 2 },
  prism: { min: 0, max: 10, step: 0.25, signed: false, decimals: 2 },
  pd_od: { min: 25, max: 40, step: 0.5, signed: false, decimals: 1 },
  pd_os: { min: 25, max: 40, step: 0.5, signed: false, decimals: 1 },
  seg_height: { min: 10, max: 35, step: 0.5, signed: false, decimals: 1 },
};
/** Base del prisma, tal como se guarda en `base`. */
export const PRISM_BASES = ["up", "down", "in", "out"];
/** Altura de montaje por debajo de la cual el pasillo del progresivo queda corto. */
export const SHORT_CORRIDOR_MM = 14;
export const RX_TYPES = ["sv", "multifocal"];
/** Campos por ojo, en el orden de la hoja de laboratorio. */
export const EYE_FIELDS = ["sph", "cyl", "axis", "add", "prism", "base"];
export const EMPTY_EYE = { sph: "", cyl: "", axis: "", add: "", prism: "", base: "" };
export const EMPTY_RX = { type: "sv", od: { ...EMPTY_EYE }, os: { ...EMPTY_EYE }, pd: "", pd_od: "", pd_os: "", seg_height: "", rx_date: "" };

export const num = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/** Formato de la hoja: signo explícito y dos decimales (+2.25, -0.75, 0.00). */
export const fmtSigned = (n, decimals = 2) => (n == null ? "" : `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(decimals)}`);
export const fmtPlain = (n, decimals = 2) => (n == null ? "" : n.toFixed(decimals));

/** Lleva un valor al paso del campo (0.25 D, 1°, 0.5 mm). */
export function snapTo(n, step) {
  if (n == null) return null;
  return round(Math.round(n / step) * step, 4);
}

/**
 * Lo que queda en la casilla al salir de ella: ajustado al paso y con el formato
 * de la hoja. Devuelve "" si no es un número. Nunca recorta al rango: el error
 * se enseña, no se esconde.
 */
/**
 * Cambia el signo de lo escrito en esfera o cilindro (botón «±» de la
 * cuadrícula): el teclado numérico de los teléfonos y tabletas no trae «−», así
 * que sin esto un cilindro negativo no se podía escribir. Vacío → «-» para
 * seguir tecleando la cifra. Pura.
 */
export function flipSign(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "+") return "-";
  if (s === "-") return "+";
  if (s.startsWith("-")) return `+${s.slice(1)}`;
  if (s.startsWith("+")) return `-${s.slice(1)}`;
  return `-${s}`;
}

export function normalizeField(field, raw) {
  const r = RX_RULES[field];
  const n = num(String(raw ?? "").replace(/^\+/, ""));
  if (!r || n == null) return "";
  const snapped = field === "axis" ? Math.round(n) : snapTo(n, r.step);
  return r.signed ? fmtSigned(snapped, r.decimals) : fmtPlain(snapped, r.decimals);
}

const inRange = (n, r) => n >= r.min && n <= r.max;
const onStep = (n, step) => Math.abs(Math.round(n / step) * step - n) < 1e-6;

/** Tipo de receta a partir de sus campos: con adición es multifocal. */
export const hasAdd = (rx) => (num(rx?.od?.add) || 0) > 0 || (num(rx?.os?.add) || 0) > 0;
export const inferType = (rx) => (hasAdd(rx) ? "multifocal" : "sv");

/** Distancia pupilar binocular (suma de las dos DNP), o null si falta una. */
export function binocularPd(rx) {
  const a = num(rx?.pd_od); const b = num(rx?.pd_os);
  return a == null || b == null ? null : round(a + b, 1);
}

/**
 * Receta del servidor / de otra pantalla → formulario. Compatibilidad: si solo
 * trae la DIP única (`pd`), se reparte a medias entre las dos DNP.
 */
export function splitPd(rx) {
  const od = num(rx?.pd_od); const os = num(rx?.pd_os); const pd = num(rx?.pd);
  if (od != null || os != null) return { pd_od: od == null ? "" : fmtPlain(od, 1), pd_os: os == null ? "" : fmtPlain(os, 1) };
  if (pd == null) return { pd_od: "", pd_os: "" };
  return { pd_od: fmtPlain(round(pd / 2, 2), 1), pd_os: fmtPlain(round(pd / 2, 2), 1) };
}

/** Cambia el tipo: en monofocal no hay adición ni altura. */
export function withType(rx, type) {
  if (type === "multifocal") return { ...rx, type };
  return { ...rx, type: "sv", od: { ...rx.od, add: "" }, os: { ...rx.os, add: "" }, seg_height: "" };
}

/**
 * Un cambio en una casilla de un ojo, con las reglas de la hoja: la adición es
 * la misma en los dos ojos; sin cilindro no hay eje.
 */
export function setEyeField(rx, eye, field, value) {
  const other = eye === "od" ? "os" : "od";
  let e = { ...rx[eye], [field]: value };
  const out = { ...rx };
  if (field === "cyl" && (num(value) || 0) === 0) e = { ...e, axis: "" };
  if (field === "prism" && (num(value) || 0) === 0) e = { ...e, base: "" };
  out[eye] = e;
  if (field === "add") out[other] = { ...rx[other], add: value };
  return out;
}

/** Cambio de DNP: mantiene `pd` (la DIP binocular) para quien aún la lee. */
export function setPd(rx, eye, value) {
  const next = { ...rx, [eye === "od" ? "pd_od" : "pd_os"]: value };
  const bin = binocularPd(next);
  return { ...next, pd: bin == null ? "" : fmtPlain(bin, 1) };
}

/**
 * Valida la receta del formulario (cadenas) para un tipo dado.
 * `mode`: "new" exige altura en multifocales; "worn" (lo que usa hoy) no, porque
 * el lensómetro no la da. Devuelve claves del diccionario por campo.
 */
export function validateRx(rx, type = inferType(rx), { mode = "new" } = {}) {
  const errors = { od: {}, os: {} };
  const warnings = { od: {}, os: {} };
  const multi = type === "multifocal";
  for (const eye of ["od", "os"]) {
    const e = rx[eye] || {};
    const sph = num(e.sph); const cyl = num(e.cyl); const axis = num(e.axis);
    const add = num(e.add); const prism = num(e.prism);
    if (sph == null) errors[eye].sph = "adm.pos.rx.err.sphRequired";
    else if (!inRange(sph, RX_RULES.sph) || !onStep(sph, 0.25)) errors[eye].sph = "adm.pos.rx.err.sph";
    if (cyl != null && (!inRange(cyl, RX_RULES.cyl) || !onStep(cyl, 0.25))) errors[eye].cyl = "adm.pos.rx.err.cyl";
    if (cyl != null && cyl !== 0) {
      if (axis == null) errors[eye].axis = "adm.pos.rx.err.axisRequired";
      else if (!Number.isInteger(axis) || !inRange(axis, RX_RULES.axis)) errors[eye].axis = "adm.pos.rx.err.axis";
    } else if (axis != null) errors[eye].axis = "adm.pos.rx.err.axisNoCyl";
    if (multi) {
      if (add == null) errors[eye].add = "adm.pos.rx.err.addRequired";
      else if (!inRange(add, RX_RULES.add) || !onStep(add, 0.25)) errors[eye].add = "adm.pos.rx.err.add";
    } else if (add != null && add !== 0) errors[eye].add = "adm.pos.rx.err.addSv";
    if (prism != null && (!inRange(prism, RX_RULES.prism) || !onStep(prism, 0.25))) errors[eye].prism = "adm.pos.rx.err.prism";
    if (prism != null && prism > 0 && !PRISM_BASES.includes(e.base)) errors[eye].base = "adm.pos.rx.err.baseRequired";
    if ((prism == null || prism === 0) && e.base) errors[eye].base = "adm.pos.rx.err.baseNoPrism";
  }
  for (const k of ["pd_od", "pd_os"]) {
    const v = num(rx[k]);
    if (v != null && !inRange(v, RX_RULES[k])) errors[k] = "adm.pos.rx.err.pd";
  }
  const pdOd = num(rx.pd_od); const pdOs = num(rx.pd_os);
  if (pdOd != null && pdOs != null && Math.abs(pdOd - pdOs) > 4) warnings.pd = "adm.pos.rx.warn.pdAsym";
  const seg = num(rx.seg_height);
  if (multi && mode === "new" && seg == null) errors.seg_height = "adm.pos.rx.err.segRequired";
  else if (seg != null && !inRange(seg, RX_RULES.seg_height)) errors.seg_height = "adm.pos.rx.err.seg";
  else if (multi && seg != null && seg < SHORT_CORRIDOR_MM) warnings.seg_height = "adm.pos.rx.warn.corridor";
  if (!multi && seg != null) errors.seg_height = "adm.pos.rx.err.segSv";
  return { errors, warnings, ok: !hasRxErrors(errors) };
}

/** ¿Hay algún error en el resultado de validateRx? */
export function hasRxErrors(errors) {
  if (!errors) return false;
  return Object.entries(errors).some(([k, v]) => (k === "od" || k === "os" ? Object.values(v || {}).some(Boolean) : Boolean(v)));
}

/** Receta del formulario → forma que espera el servidor (números o null). El tipo
 *  (monofocal/multifocal) no viaja: el servidor lo deduce de la adición.
 *  `verified` es si una persona revisó los valores: una receta tecleada a mano
 *  siempre lo está; una leída de la foto solo cuando el vendedor pulsó
 *  «Confirmar» (antes se mandaba `true` siempre y el servidor no podía
 *  distinguirlas; ahora rechaza una lectura OCR sin confirmar: `rx_unconfirmed`). */
export function toRx(form, source = "manual", verified = true) {
  const eye = (e) => ({ sph: num(e.sph), cyl: num(e.cyl), axis: num(e.axis), add: num(e.add), prism: num(e.prism), base: e.base || null });
  const pd_od = num(form.pd_od); const pd_os = num(form.pd_os);
  const pd = binocularPd(form) ?? (pd_od == null && pd_os == null ? num(form.pd) : null);
  return { od: eye(form.od), os: eye(form.os), pd, pd_od, pd_os, seg_height: num(form.seg_height), source, verified_by_user: verified === true, file_url: form.file_url || null };
}
/** Receta guardada (o leída de la foto) → formulario, ya con el formato de la hoja. */
export const fromRx = (rx) => {
  const eye = (e) => Object.fromEntries(EYE_FIELDS.map((k) => [k, k === "base" ? (e?.base || "") : e?.[k] == null ? "" : normalizeField(k, e[k]) || String(e[k])]));
  const form = { ...EMPTY_RX, od: eye(rx?.od), os: eye(rx?.os), ...splitPd(rx), pd: rx?.pd == null ? "" : String(rx.pd), seg_height: rx?.seg_height == null ? "" : normalizeField("seg_height", rx.seg_height), rx_date: "", file_url: rx?.file_url || "" };
  return { ...form, type: inferType(form) };
};
