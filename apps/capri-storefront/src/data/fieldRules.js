// Reglas de los campos de contacto y dirección: panel y checkout usan las mismas.
// El servidor vuelve a comprobarlas (apps/backend/src/lib/field-rules.ts).
//
// Módulo sin hook de idioma: devuelve CLAVES (`val.*`), y traduce quien pinta.

export const LIMITS = { name: 80, email: 254, phone: 20, street: 160, city: 80, state: 40, zip: 10, measure: 6, amount: 9 };

// Lo que no puede formar parte del campo no llega a escribirse.
export const typedPhone = (v) => String(v ?? "").replace(/[^\d+\s().-]/g, "").slice(0, LIMITS.phone);
export const typedZip = (v) => String(v ?? "").replace(/[^\d-]/g, "").slice(0, LIMITS.zip);
export const typedEmail = (v) => String(v ?? "").replace(/\s/g, "").slice(0, LIMITS.email);
/** Medidas de una receta: pueden llevar signo. */
export const typedSigned = (v) => String(v ?? "").replace(/[^\d.+-]/g, "").slice(0, LIMITS.measure);
export const typedDecimal = (v) => String(v ?? "").replace(/[^\d.]/g, "").slice(0, LIMITS.measure);

const blank = (v) => !String(v ?? "").trim();
const EMAIL = /^[^\s@.]+(\.[^\s@.]+)*@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
const PHONE = /^\+?[\d\s().-]+$/;
const NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
const PLACE = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
const ZIP = /^\d{5}(-\d{4})?$/;

/** Cada función: null si vale, o la clave del mensaje. Vacío solo vale si no es obligatorio. */
export function emailProblem(v, required = false) {
  if (blank(v)) return required ? "val.required" : null;
  return String(v).length <= LIMITS.email && EMAIL.test(String(v).trim()) ? null : "val.email";
}
export function phoneProblem(v, required = false) {
  if (blank(v)) return required ? "val.required" : null;
  const s = String(v).trim();
  const digits = s.replace(/\D/g, "").length;
  return s.length <= LIMITS.phone && PHONE.test(s) && digits >= 7 && digits <= 15 ? null : "val.phone";
}
export function nameProblem(v, required = false) {
  if (blank(v)) return required ? "val.required" : null;
  const s = String(v).trim();
  return s.length <= LIMITS.name && NAME.test(s) ? null : "val.name";
}
export function streetProblem(v, required = false) {
  if (blank(v)) return required ? "val.required" : null;
  const s = String(v).trim();
  return s.length >= 3 && s.length <= LIMITS.street && /\p{L}/u.test(s) ? null : "val.street";
}
export function cityProblem(v, required = false) {
  if (blank(v)) return required ? "val.required" : null;
  const s = String(v).trim();
  return s.length >= 2 && s.length <= LIMITS.city && PLACE.test(s) ? null : "val.city";
}
export function stateProblem(v, required = false) {
  if (blank(v)) return required ? "val.required" : null;
  const s = String(v).trim();
  return s.length >= 2 && s.length <= LIMITS.state && PLACE.test(s) ? null : "val.state";
}
export function zipProblem(v, required = false) {
  if (blank(v)) return required ? "val.required" : null;
  return ZIP.test(String(v).trim()) ? null : "val.zip";
}
export function birthProblem(v, required = false, now = new Date()) {
  if (blank(v)) return required ? "val.required" : null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) return "val.birth";
  const age = (now.getTime() - d.getTime()) / (365.25 * 86400000);
  if (age < 0 || age > 120) return "val.birth";
  // Regla del dueño (10-nov-2026): nunca del año en curso — es el «hoy» con que
  // abre el calendario, no un paciente. Igual en cleanCustomer() del backend.
  return d.getUTCFullYear() >= now.getFullYear() ? "val.birthYear" : null;
}

/** Último día aceptable como nacimiento (31-dic del año pasado): `max` del selector de fecha. */
export const birthMax = (now = new Date()) => `${now.getFullYear() - 1}-12-31`;

const onlyProblems = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));

/**
 * Dirección de partes separadas. Es opcional mientras no haga falta, pero si se
 * empieza hay que terminarla, como exige el servidor.
 */
export function addressProblems(a, { required = false, stateRequired = false } = {}) {
  const started = required || [a.address_1, a.city, a.postal_code].some((v) => !blank(v));
  return onlyProblems({
    address_1: streetProblem(a.address_1, started),
    city: cityProblem(a.city, started),
    state: stateProblem(a.state, started && stateRequired),
    postal_code: zipProblem(a.postal_code, started),
  });
}

/** Cliente de una venta del punto de venta. */
export function customerProblems(c, { requireAddress = false } = {}) {
  return onlyProblems({
    first_name: nameProblem(c.first_name, true),
    last_name: nameProblem(c.last_name, true),
    email: emailProblem(c.email, true),
    phone: phoneProblem(c.phone, true),
    // La fecha de nacimiento NO es obligatoria: en el mostrador solo se exigen
    // los datos de contacto (decisión del dueño). Si se escribe, se valida
    // igual — una fecha imposible sigue siendo un error.
    birth_date: birthProblem(c.birth_date, false),
    ...addressProblems({ ...c, state: c.province }, { required: requireAddress }),
  });
}

/** Paso de datos del checkout de la web. El celular es obligatorio solo si pidió SMS. */
export function checkoutProblems(f, { smsRequested = false } = {}) {
  return onlyProblems({
    email: emailProblem(f.email, true),
    first_name: nameProblem(f.first_name, true),
    last_name: nameProblem(f.last_name, true),
    phone: phoneProblem(f.phone, smsRequested),
    ...addressProblems(f, { required: true, stateRequired: true }),
  });
}

/** Una línea de cobro: una fila totalmente vacía todavía no es un error. */
export function paymentProblem(p, method) {
  if (!p.method_code && !p.amount) return null;
  if (!method) return "val.payMethod";
  if (!(Number(p.amount) > 0)) return "val.amount";
  for (const f of method.reference_fields || []) {
    const v = p.details?.[f.key];
    if (f.required && blank(v)) return "val.reference";
    if (f.key === "last4" && !blank(v) && !/^\d{4}$/.test(v)) return "val.last4";
  }
  return null;
}
