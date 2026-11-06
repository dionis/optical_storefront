import type { MedusaContainer } from "@medusajs/framework/types";
import { STAFF_MODULE } from "../modules/staff";
import type StaffModuleService from "../modules/staff/service";
import { canStoreSecrets, encryptSecret } from "./secret-box";
import { last4, viewPayroll, type PayrollPatch, type PayrollRow, type PayrollView } from "./staff-payroll";

/**
 * Lectura y escritura de los datos de pago del perfil. El valor completo solo
 * existe aquí dentro, el tiempo de cifrarlo: nada en este archivo devuelve un
 * SSN ni un número de cuenta, ni siquiera a quien lo acaba de escribir.
 *
 * No hay función de descifrado para el panel a propósito. El día que haya que
 * generar un fichero ACH o un W-2, se descifra EN EL SERVIDOR dentro de ese
 * proceso (con `decryptSecret`), nunca por una ruta que devuelva el número.
 */

const svc = (c: MedusaContainer) => c.resolve<StaffModuleService>(STAFF_MODULE);

async function rowOf(container: MedusaContainer, userId: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await svc(container).listStaffProfiles({ user_id: userId }, { take: 1 });
  return row as unknown as Record<string, unknown> | undefined;
}

/** Lo que puede ver el panel: método de cobro, banco y últimos 4 dígitos. */
export async function payrollOf(container: MedusaContainer, userId: string): Promise<PayrollView> {
  return viewPayroll((await rowOf(container, userId)) as PayrollRow | undefined, canStoreSecrets());
}

/** Igual, para varias personas de una vez (lista de Equipo). */
export async function payrollByUser(container: MedusaContainer, userIds: string[]): Promise<Map<string, PayrollView>> {
  const out = new Map<string, PayrollView>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return out;
  const ready = canStoreSecrets();
  const rows = await svc(container).listStaffProfiles({ user_id: ids }, { take: 1000 });
  for (const id of ids) {
    out.set(id, viewPayroll(rows.find((r) => r.user_id === id) as PayrollRow | undefined, ready));
  }
  return out;
}

/**
 * Guarda el parche ya validado. Cifra los números y escribe al lado sus
 * últimos 4; `null` borra las dos columnas a la vez (el valor cifrado y la
 * pista), nunca una sola. Sin clave de cifrado lanza `payroll_key_missing`:
 * antes que guardar un número en claro, no se guarda.
 */
export async function savePayroll(
  container: MedusaContainer,
  userId: string,
  patch: PayrollPatch,
  actorId: string | null
): Promise<PayrollView> {
  if (!canStoreSecrets()) throw new Error("payroll_key_missing");
  const data: Record<string, unknown> = {};
  if (patch.pay_method !== undefined) data.pay_method = patch.pay_method;
  if (patch.tax_id_kind !== undefined) data.tax_id_kind = patch.tax_id_kind;
  if (patch.bank_name !== undefined) data.bank_name = patch.bank_name;
  if (patch.account_holder !== undefined) data.account_holder = patch.account_holder;
  if (patch.account_type !== undefined) data.account_type = patch.account_type;

  const secret = (value: string | null | undefined, encCol: string, l4Col: string) => {
    if (value === undefined) return;
    data[encCol] = value === null ? null : encryptSecret(value);
    data[l4Col] = value === null ? null : last4(value);
  };
  secret(patch.tax_id, "tax_id_enc", "tax_id_last4");
  secret(patch.routing_number, "routing_enc", "routing_last4");
  secret(patch.account_number, "account_enc", "account_last4");

  if (Object.keys(data).length === 0) return payrollOf(container, userId);
  data.payroll_updated_at = new Date().toISOString();
  data.payroll_updated_by = actorId;

  const s = svc(container);
  const row = await rowOf(container, userId);
  if (row) await s.updateStaffProfiles({ id: row.id, ...data } as never);
  else await s.createStaffProfiles({ user_id: userId, ...data } as never);
  return payrollOf(container, userId);
}
