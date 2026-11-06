import { Migration } from "@mikro-orm/migrations";

/**
 * Datos de pago en la ficha del trabajador: cómo cobra, número fiscal y cuenta.
 *
 * Los tres números delicados se guardan cifrados (`*_enc`) y, al lado, sus
 * últimos 4 dígitos para enseñar «•••• 1234» sin descifrar. No hay ninguna
 * columna con el valor en claro, a propósito: la base nunca debe contener un
 * SSN ni un número de cuenta legible.
 *
 * `ADD COLUMN IF NOT EXISTS` porque las migraciones corren en cada despliegue.
 */
export class StaffProfilePayroll4 extends Migration {
  async up(): Promise<void> {
    for (const col of [
      "pay_method TEXT",
      "tax_id_kind TEXT",
      "tax_id_enc TEXT",
      "tax_id_last4 TEXT",
      "bank_name TEXT",
      "account_holder TEXT",
      "account_type TEXT",
      "routing_enc TEXT",
      "routing_last4 TEXT",
      "account_enc TEXT",
      "account_last4 TEXT",
      "payroll_updated_at TEXT",
      "payroll_updated_by TEXT",
    ]) {
      this.addSql(`ALTER TABLE staff_profile ADD COLUMN IF NOT EXISTS ${col};`);
    }
  }

  async down(): Promise<void> {
    for (const col of [
      "pay_method",
      "tax_id_kind",
      "tax_id_enc",
      "tax_id_last4",
      "bank_name",
      "account_holder",
      "account_type",
      "routing_enc",
      "routing_last4",
      "account_enc",
      "account_last4",
      "payroll_updated_at",
      "payroll_updated_by",
    ]) {
      this.addSql(`ALTER TABLE staff_profile DROP COLUMN IF EXISTS ${col};`);
    }
  }
}
