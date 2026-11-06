import { model } from "@medusajs/framework/utils";

/**
 * What the owner of this optician controls after hand-over — a single row (id
 * "default"). Deployment-level identity (domains, keys, currency) stays in the
 * environment; see src/lib/tenant.ts for how the two layers combine and
 * docs/MULTI-TENANT-TECNICO.md §7 for the rest of the module.
 *
 * `owner_user_id` names the owner explicitly. Until it is set the owner is the
 * oldest admin user, the rule the panel has always used.
 */
export const TenantProfile = model.define("tenant_profile", {
  id: model.id().primaryKey(),
  display_name: model.text().nullable(),
  legal_name: model.text().nullable(),
  support_phone: model.text().nullable(),
  whatsapp: model.text().nullable(),
  social: model.json().nullable(),
  pickup: model.json().nullable(),
  owner_user_id: model.text().nullable(),
  setup_completed_at: model.dateTime().nullable(),
  updated_by: model.text().nullable(),
});
