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
  /** Extra privileges granted person by person (src/lib/staff-profile.ts PRIVILEGES). */
  privileges: model.json().nullable(),
  internal_notes: model.text().nullable(),
  updated_by: model.text().nullable(),
});
