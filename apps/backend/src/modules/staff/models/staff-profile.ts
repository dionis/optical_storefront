import { model } from "@medusajs/framework/utils";

/**
 * The extended profile of a panel user (perfil del vendedor), 1:1 with a
 * Medusa user. Login data (email, password, name) stays in the user module.
 *
 * Who sees and edits each group is decided in src/lib/staff-profile.ts, not
 * here: contact and preferences are editable by the person; the seller code,
 * work terms, privileges, emergency contact and notes only by the owner or a
 * superadmin. Receipts and lab tickets carry `seller_code` only — never the
 * person's name, email or phone.
 *
 * Configuration, not order data — never purged by purge-orders.
 */
export const StaffProfile = model.define("staff_profile", {
  id: model.id({ prefix: "stfp" }).primaryKey(),
  user_id: model.text(),
  display_name: model.text().nullable(),
  /** CM07: initials + number, unique; what receipts and tickets show. */
  seller_code: model.text().nullable(),
  phone_mobile: model.text().nullable(),
  phone_whatsapp: model.text().nullable(),
  phone_landline: model.text().nullable(),
  email_alt: model.text().nullable(),
  address: model.text().nullable(),
  /** Where alerts should go when someone adds this person to an alert rule. */
  alert_email: model.text().nullable(),
  locale: model.text().nullable(),
  emergency_name: model.text().nullable(),
  emergency_relation: model.text().nullable(),
  emergency_phone: model.text().nullable(),
  hire_date: model.text().nullable(),
  commission_pct: model.float().nullable(),
  monthly_goal: model.float().nullable(),
  /** Base64 data URL or external URL for the person's profile photo. */
  photo_url: model.text().nullable(),
  /** Extra privileges granted person by person (src/lib/staff-profile.ts PRIVILEGES). */
  privileges: model.json().nullable(),
  internal_notes: model.text().nullable(),
  updated_by: model.text().nullable(),

  /*
   * Datos de pago (nómina / comisión). Los números delicados se guardan
   * CIFRADOS (`*_enc`, AES-256-GCM, src/lib/secret-box.ts) y, al lado, solo los
   * últimos 4 dígitos para que el panel pueda enseñar «•••• 1234» sin
   * descifrar nada. Quien vea un volcado de la base no ve ni un SSN ni una
   * cuenta. Reglas de acceso y validación: src/lib/staff-payroll.ts.
   */
  /** "direct_deposit" | "check" | "cash" | "zelle". */
  pay_method: model.text().nullable(),
  /** "ssn" | "itin" | "ein". */
  tax_id_kind: model.text().nullable(),
  tax_id_enc: model.text().nullable(),
  tax_id_last4: model.text().nullable(),
  bank_name: model.text().nullable(),
  /** Titular de la cuenta, cuando no coincide con el nombre de la persona. */
  account_holder: model.text().nullable(),
  /** "checking" | "savings". */
  account_type: model.text().nullable(),
  routing_enc: model.text().nullable(),
  routing_last4: model.text().nullable(),
  account_enc: model.text().nullable(),
  account_last4: model.text().nullable(),
  payroll_updated_at: model.text().nullable(),
  payroll_updated_by: model.text().nullable(),
});
