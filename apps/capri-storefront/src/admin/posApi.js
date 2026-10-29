// Punto de venta (API real /admin/pos/*). Módulo sin hook de idioma: los
// errores viajan como CLAVES adm.err.pos.<reason> y traduce quien pinta; el
// servidor calcula todos los importes, aquí nunca se suma un precio.
import { adminFetch, adminUpload } from "./adminApi.js";
import { preparePrescriptionFile } from "../lib/imagePrep.js";

/** Error con la clave de traducción y los datos extra del servidor (método, validación…). */
function posErr(e, fallback = "adm.err.pos.generic") {
  const reason = (e && e.reason) || (e && e.payload && e.payload.reason);
  const err = new Error(reason ? `adm.err.pos.${reason}` : e?.message?.startsWith("adm.") ? e.message : fallback);
  err.reason = reason || null;
  err.payload = e?.payload || null;
  return err;
}

const call = async (path, options, fallback) => {
  try {
    return await adminFetch(path, options);
  } catch (e) {
    throw posErr(e, fallback);
  }
};
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const posContext = () => call("/admin/pos/context");
export const searchProducts = (store, q) => call(`/admin/pos/products${qs({ store, q })}`);
export const searchCustomers = (q) => call(`/admin/pos/customers${qs({ q })}`);
export const fetchCustomer = (id) => call(`/admin/pos/customers/${encodeURIComponent(id)}`);
export const quote = (body) => call("/admin/pos/quote", { method: "POST", body });

export const requestApproval = (body) => call("/admin/pos/discount-approvals", { method: "POST", body });
export const fetchApproval = (id) => call(`/admin/pos/discount-approvals/${encodeURIComponent(id)}`);
export const listApprovals = (status) => call(`/admin/pos/discount-approvals${qs({ status })}`);
export const decideApproval = (id, decision, note) =>
  call(`/admin/pos/discount-approvals/${encodeURIComponent(id)}/decide`, { method: "POST", body: { decision, note } });

export const createSale = (body) => call("/admin/pos/sales", { method: "POST", body }, "adm.err.pos.sale_failed");
export const listSales = (filters) => call(`/admin/pos/sales${qs(filters)}`);
export const fetchSale = (id) => call(`/admin/pos/sales/${encodeURIComponent(id)}`);
export const collectPayment = (id, payments) => call(`/admin/pos/sales/${encodeURIComponent(id)}/payments`, { method: "POST", body: { payments } });
export const deliverSale = (id) => call(`/admin/pos/sales/${encodeURIComponent(id)}/deliver`, { method: "POST", body: {} });
export const voidSale = (id, reason, note) => call(`/admin/pos/sales/${encodeURIComponent(id)}/void`, { method: "POST", body: { reason, note } });

export const listTerminals = (store) => call(`/admin/pos/terminals${qs({ store })}`);
export const createTerminal = (body) => call("/admin/pos/terminals", { method: "POST", body });
export const updateTerminal = (id, body) => call(`/admin/pos/terminals/${encodeURIComponent(id)}`, { method: "POST", body });
/** Con el uso de cada uno (ventas, cajas, vendedores): lo que decide si se puede borrar o desactivar. */
export const listTerminalsWithUsage = (store) => call(`/admin/pos/terminals${qs({ store, usage: 1 })}`);
export const deleteTerminal = (id) => call(`/admin/pos/terminals/${encodeURIComponent(id)}`, { method: "DELETE" });

export const fetchPosSettings = () => call("/admin/pos/settings");
export const savePosSettings = (body) => call("/admin/pos/settings", { method: "POST", body });

export const listClaims = (filters) => call(`/admin/pos/insurance-claims${qs(filters)}`);
export const setClaim = (id, status, paid) => call(`/admin/pos/insurance-claims/${encodeURIComponent(id)}`, { method: "POST", body: { status, paid } });

export const listMethods = () => call("/admin/pos/payment-methods");
export const createMethod = (body) => call("/admin/pos/payment-methods", { method: "POST", body });
export const updateMethod = (id, body) => call(`/admin/pos/payment-methods/${encodeURIComponent(id)}`, { method: "POST", body });

/** Lectura automática de la receta (mismo lector que la web). Devuelve { prescription, validation }. */
export async function ocrPrescription(file) {
  const form = new FormData();
  form.append("file", await preparePrescriptionFile(file));
  try {
    return await adminUpload("/admin/pos/prescriptions/ocr", form);
  } catch (e) {
    throw posErr(e, "adm.err.pos.ocr_failed");
  }
}

/** Foto de la montura del cliente como data URL JPEG reducida (se guarda en el bucket privado). */
export async function photoDataUrl(file) {
  const prepared = await preparePrescriptionFile(file);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("adm.err.pos.photo_failed"));
    r.readAsDataURL(prepared);
  });
}

/** Nombre de una forma de pago: las de serie desde el diccionario, las del dueño con su texto. */
export const methodName = (m, t, lang) =>
  !m ? "" : m.builtin ? t(`adm.pos.method.${m.code}`) : (lang === "en" && m.label_en) || m.label || m.code;

/** Clave nueva por venta: un reintento con la misma clave nunca la registra dos veces. */
export const newIdempotencyKey = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
