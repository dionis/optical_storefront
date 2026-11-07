// Llamadas de «Reglas y comisiones» y del estado de resultados
// (/admin/finance/*, /admin/store-costs/*, /admin/costing/rules,
// /admin/pricing/{commissions,taxes,costs/toggle}). Módulo SIN hook de idioma:
// los errores viajan como CLAVE (adm.err.fin.<reason>, con respaldo en
// adm.err.pricing.<reason>) y traduce quien pinta.
import { adminFetch } from "../adminApi.js";

/** La clave de un error del servidor: `reason` → adm.err.fin.<reason>. */
export const errorKey = (e, fallback = "adm.err.fin.save_failed") => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  return r ? `adm.err.fin.${r}` : fallback;
};

const call = async (path, options, fallback) => {
  try {
    return await adminFetch(path, options);
  } catch (e) {
    const err = new Error(errorKey(e, fallback));
    err.reason = e?.reason || e?.payload?.reason || null;
    err.payload = e?.payload || null;
    throw err;
  }
};

/** Todo lo de la vista en una lectura. `store` "all" = el maestro. */
export const fetchFinanceRules = (store = "all") => call("/admin/finance/rules", { query: { store } }, "adm.err.fin.load_failed");

/**
 * Alta o edición de un costo de tienda (el registro completo: la ruta valida
 * con cleanCostItem). `amount` en dólares; `establishment_id` null = compartido.
 */
export function saveCostItem(row) {
  const body = {
    establishment_id: row.establishment_id || null,
    kind: row.kind,
    category: row.category,
    tax_category: row.tax_category,
    description: row.description || null,
    amount: Number(row.amount) || 0,
    frequency: row.frequency,
    amortize_months: row.frequency === "one_time" && row.amortize_months ? Number(row.amortize_months) : null,
    starts_on: row.starts_on,
    ends_on: row.ends_on || null,
    vendor: row.vendor || null,
    notes: row.notes || null,
    active: row.active !== false,
    per_sale: row.per_sale === true,
    allocation: row.establishment_id ? null : row.allocation || { method: "sales" },
  };
  return call(row.id ? `/admin/store-costs/${row.id}` : "/admin/store-costs", { method: "POST", body });
}

/** Borrado lógico: queda en la auditoría y en el historial. */
export const deleteCostItem = (id) => call(`/admin/store-costs/${id}`, { method: "DELETE" });

/** Una regla de costo por venta (lote de una: PUT /admin/costing/rules hace upsert por id o (kind, match_key)). */
export const saveCostRule = (rule) => call("/admin/costing/rules", { method: "PUT", body: { rules: [rule] } });
export const deleteCostRule = (id) => call(`/admin/costing/rules/${id}`, { method: "DELETE" });

/** «Se cobra» de una regla en UNA tienda. */
export const toggleRuleInStore = ({ refId, store, enabled }) => call("/admin/pricing/costs/toggle", { method: "POST", body: { kind: "rule", ref_id: refId, store, enabled } });

/** Comisión por defecto y/o la de cada vendedor. */
export function saveCommissions({ defaultPct, sellers }) {
  const body = {};
  if (defaultPct !== undefined) body.default_pct = defaultPct === null || defaultPct === "" ? null : Number(defaultPct);
  if (Array.isArray(sellers)) body.sellers = sellers.map((s) => ({ id: s.id, pct: Number(s.pct) }));
  return call("/admin/pricing/commissions", { method: "POST", body });
}

/** La comisión por defecto (formularios de alta de vendedor). null = nunca se fijó. */
export const fetchDefaultCommission = () => call("/admin/pricing/commissions", {}, "adm.err.fin.load_failed").then((d) => d?.default_pct ?? null);

/** Impuesto de venta de las monturas sin receta, en por ciento. */
export const saveSalesTax = (ratePct) => call("/admin/pricing/taxes", { method: "POST", body: { rate_pct: Number(ratePct) } });

/** El libro importado: { apply:false } devuelve el plan; { apply:true } lo aplica. */
export const importRules = (payload, apply = false) => call("/admin/finance/rules/import", { method: "POST", body: { ...payload, apply } }, "adm.err.fin.import_failed");

/** Estado de resultados: from/to YYYY-MM-DD, store id|web|all, group month|quarter|year. */
export const fetchStatement = ({ from, to, store = "all", group = "month" }) => call("/admin/finance/statement", { query: { from, to, store, group } }, "adm.err.fin.load_failed");
