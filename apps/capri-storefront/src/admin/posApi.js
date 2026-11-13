// Punto de venta (API real /admin/pos/*). Módulo sin hook de idioma: los
// errores viajan como CLAVES adm.err.pos.<reason> y traduce quien pinta; el
// servidor calcula todos los importes, aquí nunca se suma un precio.
import { adminFetch, adminFetchBlob, adminUpload } from "./adminApi.js";
import { cachedGet, invalidate } from "./adminCache.js";
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
  // Claves ordenadas: la misma consulta siempre da la misma URL (clave de la caché).
  for (const [k, v] of Object.entries(o || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
/**
 * Lectura con caché (adminCache.js): lo ya leído se devuelve al instante y se
 * refresca por detrás pasado `ttl`; dos pantallas pidiendo lo mismo = una
 * petición. Las mutaciones de abajo invalidan por prefijo (`after`).
 */
const cached = (path, ttl, fallback) => cachedGet(path, { ttl, fetcher: () => call(path, undefined, fallback) });
/** Tras una mutación: olvida esas lecturas y vuelve a pedir las que estén en pantalla. */
const after = (prefixes) => (r) => { prefixes.forEach((p) => invalidate(p)); return r; };
/** Lo que cambia al registrar, cobrar, entregar o anular una venta. */
const SALE_READS = ["/admin/pos/sales", "/admin/sales-analytics", "/admin/pos/cash", "/admin/pos/statement", "/admin/order-board", "/admin/store-costs/pnl", "/admin/start-map", "/admin/pos/customers", "/admin/patients"];
const CASH_READS = ["/admin/pos/cash", "/admin/start-map"];
const CONTEXT_READS = ["/admin/pos/context", "/admin/pos/terminals", "/admin/pos/payment-methods", "/admin/pos/settings", "/admin/establishments"];
const TTL = { context: 300_000, list: 60_000, short: 30_000 };

export const posContext = () => cached("/admin/pos/context", TTL.context);
export const searchProducts = (store, q) => call(`/admin/pos/products${qs({ store, q })}`);
export const searchCustomers = (q) => call(`/admin/pos/customers${qs({ q })}`);
export const fetchCustomer = (id) => cached(`/admin/pos/customers/${encodeURIComponent(id)}`, TTL.short);
/** «Pacientes» (docs/PATIENTS.md): lista con totales y la ficha completa de una persona. */
export const fetchPatients = (filters) => cached(`/admin/patients${qs(filters)}`, TTL.short);
export const fetchPatient = (id) => cached(`/admin/patients/${encodeURIComponent(id)}`, TTL.short);
export const quote = (body) => call("/admin/pos/quote", { method: "POST", body });

export const requestApproval = (body) => call("/admin/pos/discount-approvals", { method: "POST", body });
export const fetchApproval = (id) => call(`/admin/pos/discount-approvals/${encodeURIComponent(id)}`);
export const listApprovals = (status) => cached(`/admin/pos/discount-approvals${qs({ status })}`, TTL.short);
export const decideApproval = (id, decision, note) =>
  call(`/admin/pos/discount-approvals/${encodeURIComponent(id)}/decide`, { method: "POST", body: { decision, note } }).then(after(["/admin/pos/discount-approvals", "/admin/start-map"]));

export const createSale = (body) => call("/admin/pos/sales", { method: "POST", body }, "adm.err.pos.sale_failed").then(after(SALE_READS));
export const listSales = (filters) => cached(`/admin/pos/sales${qs(filters)}`, TTL.list);
export const fetchSale = (id) => call(`/admin/pos/sales/${encodeURIComponent(id)}`);
/** Datos de un documento de la venta SIN registrar impresión (líneas con foto, cliente, totales; `job` trae la receta). */
export const fetchSaleDocument = (id, kind) => call(`/admin/pos/sales/${encodeURIComponent(id)}/documents${qs({ kind })}`);
export const collectPayment = (id, payments) => call(`/admin/pos/sales/${encodeURIComponent(id)}/payments`, { method: "POST", body: { payments } }).then(after(SALE_READS));
/** Hand over; with `payments` (same rows as collectPayment) the balance is collected in the same call (HU-32). */
export const deliverSale = (id, payments = null) => call(`/admin/pos/sales/${encodeURIComponent(id)}/deliver`, { method: "POST", body: payments?.length ? { payments } : {} }).then(after(SALE_READS));
export const voidSale = (id, reason, note) => call(`/admin/pos/sales/${encodeURIComponent(id)}/void`, { method: "POST", body: { reason, note } }).then(after(SALE_READS));
// After the sale (backend lib/pos-sale-admin.ts): correct the details (the seller who made it or someone above them),
// and — owner and superadmin only — hide it, bring it back, or move it to another store (new number there).
export const updateSale = (id, patch) => call(`/admin/pos/sales/${encodeURIComponent(id)}`, { method: "POST", body: patch }).then(after(SALE_READS));
export const deleteSale = (id, reason, note) => call(`/admin/pos/sales/${encodeURIComponent(id)}/delete`, { method: "POST", body: { reason, note } }).then(after(SALE_READS));
export const restoreSale = (id) => call(`/admin/pos/sales/${encodeURIComponent(id)}/restore`, { method: "POST", body: {} }).then(after(SALE_READS));
export const moveSale = (id, store) => call(`/admin/pos/sales/${encodeURIComponent(id)}/move`, { method: "POST", body: { store } }).then(after(SALE_READS));
export const listDeletedSales = (store) => call(`/admin/pos/sales${qs({ deleted: 1, store })}`);
export const DELETE_REASONS = ["duplicate", "test", "wrong_store", "entered_by_mistake", "other"];

export const listTerminals = (store) => cached(`/admin/pos/terminals${qs({ store })}`, TTL.context);
export const createTerminal = (body) => call("/admin/pos/terminals", { method: "POST", body }).then(after(CONTEXT_READS));
export const updateTerminal = (id, body) => call(`/admin/pos/terminals/${encodeURIComponent(id)}`, { method: "POST", body }).then(after(CONTEXT_READS));
/** Con el uso de cada uno (ventas, cajas, vendedores): lo que decide si se puede borrar o desactivar. */
export const listTerminalsWithUsage = (store) => call(`/admin/pos/terminals${qs({ store, usage: 1 })}`);
export const deleteTerminal = (id) => call(`/admin/pos/terminals/${encodeURIComponent(id)}`, { method: "DELETE" }).then(after(CONTEXT_READS));

export const fetchPosSettings = () => cached("/admin/pos/settings", TTL.context);
export const savePosSettings = (body) => call("/admin/pos/settings", { method: "POST", body }).then(after(CONTEXT_READS));

export const listClaims = (filters) => call(`/admin/pos/insurance-claims${qs(filters)}`);
export const setClaim = (id, status, paid) => call(`/admin/pos/insurance-claims/${encodeURIComponent(id)}`, { method: "POST", body: { status, paid } }).then(after(["/admin/pos/insurance-claims", ...SALE_READS]));

/** Estado de cuenta de una tienda ({ establishment_id: id | "all", from, to } en YYYY-MM-DD; sin fechas = mes en curso). */
export const fetchStatement = (params) => cached(`/admin/pos/statement${qs(params)}`, TTL.list);

/** Caja de la TIENDA (HU-32): sesiones con su libro de movimientos; `store` = id de la tienda. */
export const listCashSessions = (store, limit) => cached(`/admin/pos/cash-sessions${qs({ store, limit })}`, TTL.short);
/** Una sesión con su libro completo, las ventas enlazadas ({ [sale_id]: { number, customer_name… } }) y su auditoría. */
export const fetchCashSession = (id) => call(`/admin/pos/cash-sessions/${encodeURIComponent(id)}`);
/** { store, opening, signature (iniciales), note?, terminal_id? } abre la caja de la tienda. */
export const openCashSession = (body) => call("/admin/pos/cash-sessions", { method: "POST", body }).then(after(CASH_READS));
/** { kind, amount, category, note, terminal_id? } entrada o salida manual. */
export const addCashMovement = (id, body) => call(`/admin/pos/cash-sessions/${encodeURIComponent(id)}/movement`, { method: "POST", body }).then(after(CASH_READS));
/** { counted, signature, note?, approval_signature? } cierra con el conteo y las iniciales. */
export const closeCashSession = (id, body) => call(`/admin/pos/cash-sessions/${encodeURIComponent(id)}/close`, { method: "POST", body }).then(after(CASH_READS));
/** { approval_signature } el dueño autoriza una diferencia con sus iniciales. */
export const approveCashSession = (id, approvalSignature) => call(`/admin/pos/cash-sessions/${encodeURIComponent(id)}/approve`, { method: "POST", body: { approval_signature: approvalSignature } }).then(after(CASH_READS));
/** Documento de apertura o cierre; `print` registra la impresión en auditoría. */
export const fetchCashDocument = (id, kind, print = false) => call(`/admin/pos/cash-sessions/${encodeURIComponent(id)}/document${qs({ kind, print: print ? 1 : "" })}`);
/** Reenvía el documento al dueño y a la lista de administradores. */
export const emailCashDocument = (id, kind) => call(`/admin/pos/cash-sessions/${encodeURIComponent(id)}/email`, { method: "POST", body: { kind } });

export const listMethods = () => cached("/admin/pos/payment-methods", TTL.context);
export const createMethod = (body) => call("/admin/pos/payment-methods", { method: "POST", body }).then(after(CONTEXT_READS));
export const updateMethod = (id, body) => call(`/admin/pos/payment-methods/${encodeURIComponent(id)}`, { method: "POST", body }).then(after(CONTEXT_READS));

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
/**
 * La foto del paciente con la montura puesta (docs/WEARING-PHOTO.md): se queda
 * en la tienda. Subir/reemplazar exige el consentimiento del paciente; leerla
 * devuelve un Blob (nunca un enlace) y cada lectura queda en Auditoría.
 */
export const setWearingPhoto = (id, photo) =>
  call(`/admin/pos/sales/${encodeURIComponent(id)}/wearing-photo`, { method: "POST", body: { photo, consent: true } }).then(after(["/admin/pos/sales"]));
export const removeWearingPhoto = (id) =>
  call(`/admin/pos/sales/${encodeURIComponent(id)}/wearing-photo`, { method: "DELETE" }).then(after(["/admin/pos/sales"]));
/**
 * Foto de una montura fuera del catálogo (montura de la tienda): se guarda con
 * las imágenes públicas del catálogo y sale en el recibo, el correo y la ficha.
 */
export const setStoreFramePhoto = (id, photo) =>
  call(`/admin/pos/sales/${encodeURIComponent(id)}/store-frame-photo`, { method: "POST", body: { photo } }).then(after(["/admin/pos/sales"]));
export async function fetchWearingPhoto(id) {
  try {
    return await adminFetchBlob(`/admin/pos/sales/${encodeURIComponent(id)}/wearing-photo`);
  } catch (e) {
    throw posErr(e);
  }
}

/** Lo que el servidor guarda como foto de una montura (lib/store-frame-photo.ts, own-frame). */
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * La foto de una montura, de la cámara o de un archivo, como `data:` URL lista
 * para viajar con la venta: reducida a JPEG de 1600 px (una foto de tableta
 * pesa 4–12 MB). Si el navegador no pudo leerla (un formato raro), se avisa
 * AQUÍ en vez de mandar algo que el servidor descartaría en silencio.
 */
export async function photoDataUrl(file) {
  const prepared = await preparePrescriptionFile(file);
  if (!PHOTO_TYPES.has(String(prepared?.type || "").toLowerCase())) throw new Error("adm.err.pos.photo_format");
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
