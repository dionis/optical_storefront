import { model } from "@medusajs/framework/utils";

/**
 * What the owner of this optician controls after hand-over — a single row (id
 * "default"). Deployment-level identity (domains, keys, currency) stays in the
 * environment; see src/lib/tenant.ts for how the two layers combine and
 * docs/MULTI-TENANT-TECNICO.md §7 for the rest of the module.
 *
 * Who the owner is does NOT live here: store_setting.owner_user_id (a transfer
 * from Equipo → «Hacer dueño») > STORE_OWNER_EMAIL > oldest user, decided by
 * ownerUserId in src/lib/staff-scope.ts.
 */
export const TenantProfile = model.define("tenant_profile", {
  id: model.id().primaryKey(),
  display_name: model.text().nullable(),
  legal_name: model.text().nullable(),
  support_phone: model.text().nullable(),
  whatsapp: model.text().nullable(),
  social: model.json().nullable(),
  pickup: model.json().nullable(),
  /** Colours and logos chosen in the panel (src/lib/tenant-brand.ts); null = the deployment's. */
  brand: model.json().nullable(),
  /** The brand before the last change, for "back to the previous brand". */
  brand_previous: model.json().nullable(),
  setup_completed_at: model.dateTime().nullable(),
  updated_by: model.text().nullable(),
});
