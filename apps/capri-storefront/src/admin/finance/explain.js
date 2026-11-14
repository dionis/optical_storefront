// Dónde se usa: «Reglas y comisiones» → cada fila de costo (CostsSection.jsx) y
// la guía contable (AccountingGuide.jsx).
//
// El dueño (13-nov-2026): «hay que especificar para cada cosa si es un costo
// para una tienda exactamente o un costo que se divide de manera mensual,
// semanal, etc. entre todos los negocios». Una fila tenía todo eso, pero en
// seis columnas que había que saber leer juntas. Esto lo dice de corrido, en
// cuatro respuestas: DE QUIÉN es, CADA CUÁNTO se paga y cuánto pesa al mes,
// QUIÉN lo cargó este mes, y DÓNDE cae en el estado de resultados y en la
// declaración. Puro: no pinta nada, devuelve las piezas ya calculadas.
import { F1120S, MONTHLY_FACTOR, monthlyOf, SCHEDULE_C, taxOf } from "./model.js";

/** De quién es una partida. */
export function whoOf(row) {
  if (row.per_sale) return row.establishment_id ? "perSaleOwn" : "perSaleAll";
  return row.establishment_id ? "own" : "shared";
}

/** Cómo se lleva al mes: la clave del texto y los números que usa. */
export function cadenceOf(row, sales = null) {
  const amount = Number(row.amount) || 0;
  const monthly = monthlyOf(row, sales);
  if (row.per_sale) return { key: "perSale", amount, monthly, n: Math.max(0, Math.floor(Number(sales) || 0)) };
  if (row.frequency === "one_time") {
    const n = Number(row.amortize_months) > 1 ? Number(row.amortize_months) : 1;
    return n > 1 ? { key: "oneTimeSpread", amount, monthly, n } : { key: "oneTime", amount, monthly, month: String(row.starts_on || "").slice(0, 7) };
  }
  const freq = MONTHLY_FACTOR[row.frequency] ? row.frequency : "monthly";
  const [a, b] = MONTHLY_FACTOR[freq];
  return { key: freq, amount, monthly, times: a, over: b };
}

/** Dónde cae: qué clase de costo es para el resultado y en qué renglón fiscal. */
export function landsOf(row) {
  const tax = taxOf(row);
  const bucket = tax === "cost_of_goods" ? "cogs" : row.per_sale || row.kind === "variable" ? "variable" : "fixed";
  return { bucket, tax, schedule_c: SCHEDULE_C[tax] || "27a", f1120s: F1120S[tax] || "19" };
}

/** El reparto fijo de un compartido «por porcentajes», en el orden de las tiendas. */
export function percentSharesOf(row, stores) {
  if (row.establishment_id || row.per_sale || row.allocation?.method !== "percent") return [];
  return stores
    .map((s) => ({ id: s.id, code: s.code, color: s.color || null, pct: Number(row.allocation.shares?.[s.id]) || 0 }))
    .filter((x) => x.pct > 0);
}
