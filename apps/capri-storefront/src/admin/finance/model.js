// Reglas de «Reglas y comisiones» que el navegador necesita para pintar sin
// esperar al servidor: la normalización mensual de cada frecuencia, el mapa
// categoría ↔ categoría fiscal y en qué acordeón va cada costo. Son COPIA de
// apps/backend/src/lib/store-costs.ts (la fuente): si cambias una, cambia la
// otra. El servidor recalcula todo lo que se guarda; esto es solo la vista
// previa mientras se escribe.

export const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "annual", "one_time"];

/** Equivalente mensual de cada frecuencia (numerador / denominador). */
export const MONTHLY_FACTOR = { daily: [365, 12], weekly: [52, 12], biweekly: [26, 12], monthly: [1, 1], quarterly: [1, 3], annual: [1, 12] };

export const TAX_CATEGORIES = ["cost_of_goods", "rent", "utilities", "payroll", "payroll_taxes", "insurance", "advertising", "software", "professional_fees", "bank_fees", "repairs", "supplies", "taxes_licenses", "depreciation", "other"];

export const CATEGORY_TAX = { rent: "rent", maintenance: "repairs", utilities: "utilities", salaries: "payroll", insurance: "insurance", licenses: "taxes_licenses", subscriptions: "software", equipment: "depreciation", supplies: "supplies", shipping: "other", repairs: "repairs", remakes: "cost_of_goods", accounting: "professional_fees", other: "other" };

export const TAX_DEFAULT_CATEGORY = { cost_of_goods: "remakes", rent: "rent", utilities: "utilities", payroll: "salaries", payroll_taxes: "salaries", insurance: "insurance", advertising: "other", software: "subscriptions", professional_fees: "accounting", bank_fees: "other", repairs: "repairs", supplies: "supplies", taxes_licenses: "licenses", depreciation: "equipment", other: "other" };

/** Línea de Schedule C (Form 1040) y de Form 1120-S. Copia de TAX_LINES (lib/financial-statement.ts), para el libro de Excel. */
export const SCHEDULE_C = { cost_of_goods: "4", rent: "20b", utilities: "25", payroll: "26", payroll_taxes: "23", insurance: "15", advertising: "8", software: "18", professional_fees: "17", bank_fees: "27a", repairs: "21", supplies: "22", taxes_licenses: "23", depreciation: "13", other: "27a" };

export const taxOf = (item) => (TAX_CATEGORIES.includes(item?.tax_category) ? item.tax_category : CATEGORY_TAX[item?.category] || "other");

/** El equivalente mensual de un costo, en DÓLARES (un costo por venta: × las ventas del mes). */
export function monthlyOf(item, salesPerMonth = null) {
  const cents = Math.round((Number(item?.amount) || 0) * 100);
  if (item?.per_sale) return (salesPerMonth == null ? cents : cents * Math.max(0, Math.floor(salesPerMonth))) / 100;
  if (item?.frequency === "one_time") {
    const n = Number(item.amortize_months) > 1 ? Number(item.amortize_months) : 1;
    return Math.round(cents / n) / 100;
  }
  const [a, b] = MONTHLY_FACTOR[item?.frequency] || MONTHLY_FACTOR.monthly;
  return Math.round((cents * a) / b) / 100;
}

export const TAX_GROUP = new Set(["taxes_licenses", "payroll_taxes"]);

/** En qué acordeón va un costo: por venta > impuestos > compartido > fijo / variable. */
export function groupOf(item) {
  if (item.per_sale) return "perSale";
  if (TAX_GROUP.has(taxOf(item))) return "taxes";
  if (!item.establishment_id) return "shared";
  return item.kind === "fixed" ? "fixed" : "variable";
}

export const GROUPS = ["fixed", "variable", "shared", "perSale", "taxes"];

/** Un costo nuevo de un acordeón, con lo que ese acordeón supone. */
export function blankItem(group, { storeId = null, firstStoreId = null, today = new Date() } = {}) {
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const own = storeId || firstStoreId || null;
  const base = { id: null, description: "", amount: "", frequency: "monthly", amortize_months: "", starts_on: `${month}-01`, ends_on: "", vendor: "", notes: "", active: true, per_sale: false, allocation: null };
  const by = {
    fixed: { establishment_id: own, kind: "fixed", tax_category: "rent" },
    variable: { establishment_id: own, kind: "variable", tax_category: "supplies" },
    shared: { establishment_id: null, kind: "fixed", tax_category: "software", allocation: { method: "sales" } },
    perSale: { establishment_id: storeId || null, kind: "variable", tax_category: "supplies", per_sale: true, allocation: storeId ? null : { method: "sales" } },
    taxes: { establishment_id: own, kind: "fixed", tax_category: "taxes_licenses", frequency: "annual" },
  }[group];
  const row = { ...base, ...by };
  return { ...row, category: TAX_DEFAULT_CATEGORY[row.tax_category] };
}

/** Las reglas de costo de cada venta que se pueden dar de alta aquí. */
export const RULE_KINDS = ["order_fixed", "order_percent", "payment_fixed"];

/** Clave de una regla nueva a partir de su nombre (la misma normalización que el servidor). */
export const slugOf = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

/** Σ por clave de lo que devuelve `pick`. */
export const sumBy = (rows, key, pick) => {
  const out = new Map();
  for (const r of rows) {
    const k = key(r);
    out.set(k, (out.get(k) || 0) + (Number(pick(r)) || 0));
  }
  return out;
};

/** Dólares con dos decimales sin errores de coma flotante en una suma. */
export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** localStorage que nunca rompe la pantalla (ventana privada, datos bloqueados). */
export const store = {
  get(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* sin almacenamiento: la vista funciona igual */
    }
  },
};
