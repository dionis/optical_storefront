// Dónde se usa: la guía contable de «Reglas y comisiones» (AccountingGuide.jsx).
//
// El ejemplo con números de la guía: UN mes de UNA tienda y UN pedido de la
// tienda online. Las cifras de partida son inventadas y redondas; todo lo
// demás se CALCULA aquí con las mismas reglas del libro (model.js: la
// frecuencia llevada al mes, el reparto de un compartido, importe × ventas),
// para que la guía nunca enseñe una suma que el panel no haría. Puro.
import { F1120S, monthlyOf, SCHEDULE_C, taxOf } from "./model.js";

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct1 = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Las cifras de partida del mes de ejemplo. */
export const EXAMPLE_MONTH = {
  sales: 100,
  net: 20000,
  /** Parte de las ventas que llevó impuesto (monturas solas, accesorios) y la tasa. */
  taxable: 10000,
  taxRatePct: 7,
  cogs: { frames: 4000, lenses: 2400, lab: 600 },
  cardFees: 427,
  commissionPct: 5,
  /** El compartido se reparte según ventas: esta tienda vendió este % de la cadena. */
  chainSharePct: 40,
  chainStores: 4,
  items: [
    { key: "rent", who: "own", kind: "fixed", amount: 3000, frequency: "monthly", tax_category: "rent" },
    { key: "cleaning", who: "own", kind: "fixed", amount: 100, frequency: "weekly", tax_category: "repairs" },
    { key: "insurance", who: "own", kind: "fixed", amount: 1200, frequency: "annual", tax_category: "insurance" },
    { key: "license", who: "own", kind: "fixed", amount: 600, frequency: "annual", tax_category: "taxes_licenses" },
    { key: "software", who: "shared", kind: "fixed", amount: 400, frequency: "monthly", tax_category: "software" },
    { key: "supplies", who: "own", kind: "variable", amount: 300, frequency: "monthly", tax_category: "supplies" },
    { key: "packaging", who: "own", kind: "variable", per_sale: true, amount: 2, tax_category: "supplies" },
  ],
};

/** Orden de los gastos en el Schedule C (lo que el contador recorre de arriba abajo). */
const EXPENSE_ORDER = ["advertising", "commissions", "depreciation", "insurance", "professional_fees", "software", "rent", "repairs", "supplies", "taxes_licenses", "payroll_taxes", "utilities", "payroll", "card_fees", "bank_fees", "other"];
const LINE = { revenue: ["1", "1a"], cogs: ["4", "2"], gross_profit: ["5", "3"], commissions: ["10", "19"], card_fees: ["27a", "19"], opex: ["28", "20"], net_income: ["31", "21"] };

/** El mes de ejemplo, calculado. Importes en dólares. */
export function guideMonth(ex = EXAMPLE_MONTH) {
  const items = ex.items.map((it) => {
    const monthly = monthlyOf(it, it.per_sale ? ex.sales : null);
    // Un compartido se carga a esta tienda en su parte; lo demás, entero.
    const charged = it.who === "shared" ? r2((monthly * ex.chainSharePct) / 100) : monthly;
    const tax = taxOf(it);
    return { ...it, monthly, charged, tax, bucket: it.per_sale || it.kind === "variable" ? "variable" : "fixed" };
  });
  const sum = (list) => r2(list.reduce((s, x) => s + x.charged, 0));
  const salesTax = r2((ex.taxable * ex.taxRatePct) / 100);
  const cogs = r2(ex.cogs.frames + ex.cogs.lenses + ex.cogs.lab);
  const grossProfit = r2(ex.net - cogs);
  const commissions = r2((ex.net * ex.commissionPct) / 100);
  const variableItems = sum(items.filter((i) => i.bucket === "variable"));
  const variable = r2(ex.cardFees + commissions + variableItems);
  const contribution = r2(grossProfit - variable);
  const fixedOwn = sum(items.filter((i) => i.bucket === "fixed" && i.who === "own"));
  const shared = sum(items.filter((i) => i.bucket === "fixed" && i.who === "shared"));
  const fixed = r2(fixedOwn + shared);
  const result = r2(contribution - fixed);
  const margin = ex.net > 0 ? contribution / ex.net : null;
  const breakEven = margin && margin > 0 ? r2(fixed / margin) : null;

  // El «vector fiscal»: las mismas cifras, ordenadas por renglón de la declaración.
  const byTax = new Map();
  for (const it of items) byTax.set(it.tax, r2((byTax.get(it.tax) || 0) + it.charged));
  byTax.set("commissions", commissions);
  byTax.set("card_fees", ex.cardFees);
  const expenses = EXPENSE_ORDER.filter((k) => byTax.get(k)).map((k) => ({ key: k, amount: byTax.get(k), schedule_c: (LINE[k] || [SCHEDULE_C[k]])[0], f1120s: (LINE[k] || [null, F1120S[k]])[1] }));
  const opex = r2(expenses.reduce((s, e) => s + e.amount, 0));
  const fiscal = [
    { key: "revenue", amount: ex.net, schedule_c: LINE.revenue[0], f1120s: LINE.revenue[1], strong: true },
    { key: "cogs", amount: cogs, minus: true, schedule_c: LINE.cogs[0], f1120s: LINE.cogs[1] },
    { key: "gross_profit", amount: grossProfit, schedule_c: LINE.gross_profit[0], f1120s: LINE.gross_profit[1], strong: true },
    ...expenses.map((e) => ({ ...e, minus: true, expense: true })),
    { key: "opex", amount: opex, minus: true, schedule_c: LINE.opex[0], f1120s: LINE.opex[1], strong: true },
    { key: "net_income", amount: r2(grossProfit - opex), schedule_c: LINE.net_income[0], f1120s: LINE.net_income[1], strong: true, final: true },
  ];
  return {
    ex, items, salesTax, charged: r2(ex.net + salesTax), cogs, grossProfit, grossPct: pct1(grossProfit, ex.net), commissions, variableItems, variable,
    contribution, contributionPct: pct1(contribution, ex.net), fixedOwn, shared, fixed, result, breakEven, fiscal, opex,
  };
}

/** Las cifras de partida del pedido de ejemplo de la tienda online. */
export const EXAMPLE_ORDER = { frameCost: 25, multiple: 3, lensPrice: 60, lensCost: 18, delivery: 30, gatewayPct: 2.9, gatewayFixed: 0.3, carrier: 12 };

/** Un pedido de la tienda online, calculado. */
export function guideOrder(ex = EXAMPLE_ORDER) {
  const framePrice = r2(ex.frameCost * ex.multiple);
  const sales = r2(framePrice + ex.lensPrice);
  const paid = r2(sales + ex.delivery);
  const income = paid;
  const cogs = r2(ex.frameCost + ex.lensCost);
  const gateway = r2(Math.round(paid * ex.gatewayPct) / 100 + ex.gatewayFixed);
  const left = r2(income - cogs - gateway - ex.carrier);
  return { ex, framePrice, sales, paid, income, cogs, gateway, left, leftPct: pct1(left, income) };
}
