/**
 * Datos de pago de quien trabaja en la óptica (nómina o comisión): número
 * fiscal (SSN/ITIN/EIN) y cuenta bancaria. Módulo PURO: valida y enmascara,
 * no cifra ni guarda (eso es `secret-box.ts` y `staff-payroll-data.ts`).
 *
 * Reglas de la casa, por si alguien añade un campo mañana:
 *  1. El valor completo NUNCA sale del servidor. Se guarda cifrado y lo que
 *     viaja al panel son los últimos 4 dígitos y el banco.
 *  2. El valor completo NUNCA se escribe en un log, un correo, la hoja de
 *     Google ni una exportación.
 *  3. Solo el dueño y un superadmin pueden ver o editar los de otra persona;
 *     cada quien puede poner los suyos.
 *  4. Todo cambio queda en Auditoría, con qué campo cambió y los últimos 4,
 *     nunca el número.
 */

export const TAX_ID_KINDS = ["ssn", "itin", "ein"] as const;
export type TaxIdKind = (typeof TAX_ID_KINDS)[number];
export const ACCOUNT_TYPES = ["checking", "savings"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
/** Cómo cobra la persona. `direct_deposit` es el único que necesita cuenta. */
export const PAY_METHODS = ["direct_deposit", "check", "cash", "zelle"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

const digits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");
export const last4 = (v: string): string => v.slice(-4);
/** Lo que ve el panel: •••• 1234 (nunca el número). */
export const masked = (l4: string | null | undefined): string | null => (l4 ? `•••• ${l4}` : null);

/**
 * SSN válido según las reglas de la Social Security Administration: 9 dígitos,
 * área ≠ 000/666/900-999, grupo ≠ 00, serie ≠ 0000. Un número imposible suele
 * ser un error de tecleo, y descubrirlo el día de la nómina cuesta caro.
 */
export function isValidSsn(raw: unknown): boolean {
  const d = digits(raw);
  if (d.length !== 9) return false;
  const area = Number(d.slice(0, 3));
  const group = Number(d.slice(3, 5));
  const serial = Number(d.slice(5));
  if (area === 0 || area === 666 || area >= 900) return false;
  return group !== 0 && serial !== 0;
}

/**
 * ITIN: empieza por 9 y el grupo (dígitos 4-5) está en los rangos que asigna
 * el IRS (50–65, 70–88, 90–92, 94–99).
 */
export function isValidItin(raw: unknown): boolean {
  const d = digits(raw);
  if (d.length !== 9 || d[0] !== "9") return false;
  const g = Number(d.slice(3, 5));
  return (g >= 50 && g <= 65) || (g >= 70 && g <= 88) || (g >= 90 && g <= 92) || (g >= 94 && g <= 99);
}

/** EIN: 9 dígitos (el prefijo ya no identifica estado; no se valida más). */
export const isValidEin = (raw: unknown): boolean => digits(raw).length === 9;

export function isValidTaxId(kind: TaxIdKind, raw: unknown): boolean {
  if (kind === "ssn") return isValidSsn(raw);
  if (kind === "itin") return isValidItin(raw);
  return isValidEin(raw);
}

/**
 * Ruta bancaria (ABA): 9 dígitos y dígito de control
 * 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10). Pillar aquí un
 * número mal copiado evita una transferencia devuelta (o peor, a otra cuenta).
 */
export function isValidRouting(raw: unknown): boolean {
  const d = digits(raw);
  if (d.length !== 9) return false;
  const n = d.split("").map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0;
}

/** Número de cuenta: 4 a 17 dígitos (lo que admite el ACH de EE. UU.). */
export const isValidAccountNumber = (raw: unknown): boolean => {
  const d = digits(raw);
  return d.length >= 4 && d.length <= 17;
};

/** Lo que el panel manda al guardar. Los números llegan completos, una sola vez. */
export interface PayrollPatchInput {
  pay_method?: unknown;
  tax_id_kind?: unknown;
  tax_id?: unknown;
  bank_name?: unknown;
  account_holder?: unknown;
  account_type?: unknown;
  routing_number?: unknown;
  account_number?: unknown;
}

/** Lo ya validado: los secretos en claro (para cifrarlos) y el resto tal cual. */
export interface PayrollPatch {
  pay_method?: PayMethod | null;
  tax_id_kind?: TaxIdKind | null;
  /** null = borrar el número guardado. */
  tax_id?: string | null;
  bank_name?: string | null;
  account_holder?: string | null;
  account_type?: AccountType | null;
  routing_number?: string | null;
  account_number?: string | null;
}

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s ? s : null;
};
/** Lo que el panel enseña como valor guardado; reenviarlo no cambia nada. */
const isMask = (v: unknown): boolean => typeof v === "string" && /^[•*\s]*\d{0,4}$/.test(v.trim()) && /[•*]/.test(v);

/**
 * Valida el formulario. Un campo ausente no se toca; "" borra. Reenviar la
 * máscara (•••• 1234) tampoco toca nada: el panel la enseña como valor actual.
 */
export function cleanPayrollPatch(input: PayrollPatchInput | null | undefined): { reason: string; field?: string } | { patch: PayrollPatch } {
  const i = input ?? {};
  const out: PayrollPatch = {};

  if (i.pay_method !== undefined) {
    const v = text(i.pay_method, 20);
    if (v && !(PAY_METHODS as readonly string[]).includes(v)) return { reason: "bad_pay_method", field: "pay_method" };
    out.pay_method = v as PayMethod | null;
  }
  if (i.tax_id_kind !== undefined) {
    const v = text(i.tax_id_kind, 10)?.toLowerCase() ?? null;
    if (v && !(TAX_ID_KINDS as readonly string[]).includes(v)) return { reason: "bad_tax_id_kind", field: "tax_id_kind" };
    out.tax_id_kind = v as TaxIdKind | null;
  }
  if (i.tax_id !== undefined && !isMask(i.tax_id)) {
    const raw = text(i.tax_id, 40);
    if (raw === null) out.tax_id = null;
    else {
      const kind = (out.tax_id_kind ?? (text(i.tax_id_kind, 10) as TaxIdKind | null) ?? "ssn") as TaxIdKind;
      if (!isValidTaxId(kind, raw)) return { reason: "bad_tax_id", field: "tax_id" };
      out.tax_id = digits(raw);
    }
  }
  if (i.bank_name !== undefined) out.bank_name = text(i.bank_name, 80);
  if (i.account_holder !== undefined) out.account_holder = text(i.account_holder, 120);
  if (i.account_type !== undefined) {
    const v = text(i.account_type, 10)?.toLowerCase() ?? null;
    if (v && !(ACCOUNT_TYPES as readonly string[]).includes(v)) return { reason: "bad_account_type", field: "account_type" };
    out.account_type = v as AccountType | null;
  }
  if (i.routing_number !== undefined && !isMask(i.routing_number)) {
    const raw = text(i.routing_number, 20);
    if (raw === null) out.routing_number = null;
    else {
      if (!isValidRouting(raw)) return { reason: "bad_routing", field: "routing_number" };
      out.routing_number = digits(raw);
    }
  }
  if (i.account_number !== undefined && !isMask(i.account_number)) {
    const raw = text(i.account_number, 40);
    if (raw === null) out.account_number = null;
    else {
      if (!isValidAccountNumber(raw)) return { reason: "bad_account_number", field: "account_number" };
      out.account_number = digits(raw);
    }
  }
  return { patch: out };
}

/** Lo que de verdad viaja al panel: nada que se pueda usar para cobrar. */
export interface PayrollView {
  pay_method: PayMethod | null;
  tax_id_kind: TaxIdKind | null;
  tax_id_masked: string | null;
  bank_name: string | null;
  account_holder: string | null;
  account_type: AccountType | null;
  routing_masked: string | null;
  account_masked: string | null;
  updated_at: string | null;
  /** false cuando el despliegue no tiene clave de cifrado: el panel lo explica y no deja guardar. */
  storage_ready: boolean;
}

/** Fila guardada (columnas `payroll_*` del perfil). */
export interface PayrollRow {
  pay_method?: string | null;
  tax_id_kind?: string | null;
  tax_id_last4?: string | null;
  bank_name?: string | null;
  account_holder?: string | null;
  account_type?: string | null;
  routing_last4?: string | null;
  account_last4?: string | null;
  payroll_updated_at?: string | null;
}

export function viewPayroll(row: PayrollRow | null | undefined, storageReady: boolean): PayrollView {
  const r = row ?? {};
  return {
    pay_method: (r.pay_method as PayMethod) ?? null,
    tax_id_kind: (r.tax_id_kind as TaxIdKind) ?? null,
    tax_id_masked: masked(r.tax_id_last4),
    bank_name: r.bank_name ?? null,
    account_holder: r.account_holder ?? null,
    account_type: (r.account_type as AccountType) ?? null,
    routing_masked: masked(r.routing_last4),
    account_masked: masked(r.account_last4),
    updated_at: r.payroll_updated_at ?? null,
    storage_ready: storageReady,
  };
}

/**
 * Lo que se escribe en Auditoría: qué campos cambiaron y, de los números, solo
 * los últimos 4. Nunca el valor.
 */
export function payrollAuditDetail(patch: PayrollPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { fields: Object.keys(patch) };
  if (patch.tax_id !== undefined) out.tax_id_last4 = patch.tax_id ? last4(patch.tax_id) : null;
  if (patch.routing_number !== undefined) out.routing_last4 = patch.routing_number ? last4(patch.routing_number) : null;
  if (patch.account_number !== undefined) out.account_last4 = patch.account_number ? last4(patch.account_number) : null;
  if (patch.pay_method !== undefined) out.pay_method = patch.pay_method;
  if (patch.bank_name !== undefined) out.bank_name = patch.bank_name;
  return out;
}

/** Con depósito directo hacen falta ruta y cuenta: avisar antes de la nómina, no durante. */
export function payrollIncomplete(view: PayrollView): boolean {
  return view.pay_method === "direct_deposit" && (!view.routing_masked || !view.account_masked);
}
