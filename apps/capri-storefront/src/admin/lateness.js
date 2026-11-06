// Días de atraso frente a la fecha prometida al cliente (`promised_on`,
// YYYY-MM-DD, la que imprime el recibo del POS). Lo comparten Cobros
// pendientes (PendingBalances.jsx: atraso del saldo) y Pedidos y etapas
// (StoreOrders.jsx: pedido atrasado frente a lo prometido, HU-33, con o sin
// saldo). La fecha es LOCAL de quien mira — la óptica — por eso se arma con
// `T00:00:00` sin zona: un "2026-10-20" prometido se cumple a las 00:00 de ese
// día en el reloj de la tienda, no en UTC.
const DAY = 86400000;

/** Medianoche local de hoy (o de `now`) en milisegundos. */
export const startOfLocalDay = (now = Date.now()) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * Días enteros desde la fecha prometida (o, sin ella, desde `created_at`);
 * nunca negativo. Es la columna «Días de atraso» de Cobros pendientes.
 */
export const daysOverdue = (sale, now = Date.now()) => {
  const since = sale.promised_on ? Date.parse(`${sale.promised_on}T00:00:00`) : Date.parse(sale.created_at);
  return Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / DAY)) : 0;
};

/**
 * Días de atraso de un pedido frente a su fecha prometida: `null` si no hay
 * promesa o todavía no venció (el día prometido cuenta como a tiempo), y si no
 * los días enteros entre el día prometido y HOY (fechas locales: a las 00:01
 * del día siguiente ya es 1 día). Pure.
 */
export const daysLate = (promisedOn, now = Date.now()) => {
  if (!promisedOn) return null;
  const due = Date.parse(`${promisedOn}T00:00:00`);
  if (!Number.isFinite(due)) return null;
  const n = Math.round((startOfLocalDay(now) - due) / DAY);
  return n > 0 ? n : null;
};
