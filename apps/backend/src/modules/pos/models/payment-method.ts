import { model } from "@medusajs/framework/utils";

/**
 * A way a point-of-sale customer can pay (forma de pago). Seeded with the
 * owner's five — débito, crédito, Zelle, efectivo, seguro médico — and
 * extensible by the owner or a superadmin.
 *
 * Built-in methods keep `label` null: the panel shows them through
 * `t("adm.pos.method.<code>")`, in the chosen language. Methods the owner adds
 * carry the owner's own label (configurable data, not UI copy).
 *
 * `receivable`: the money arrives later from a third party (medical insurance),
 * so the sale is paid in full but that part is an account receivable.
 *
 * Never deleted (old sales point at the code), only deactivated.
 */
export const PosPaymentMethod = model.define("pos_payment_method", {
  id: model.id({ prefix: "pospm" }).primaryKey(),
  code: model.text(),
  label: model.text().nullable(),
  /** English name of an owner-added method; the Spanish one is `label`. */
  label_en: model.text().nullable(),
  /** cash | debit | credit | zelle | insurance | other — drives the checkout form. */
  kind: model.text().default("other"),
  receivable: model.boolean().default(false),
  /** Fee charged by the processor: a percentage and/or a fixed amount, a variable cost of the store. */
  fee_pct: model.float().default(0),
  fee_fixed_cents: model.number().default(0),
  /** Counts in the cash register count at closing. */
  counts_as_cash: model.boolean().default(false),
  /** Stores where it is accepted; null/empty = all. */
  establishment_ids: model.json().nullable(),
  /** Data asked when charging: [{ key, required, label?, label_en? }]. */
  reference_fields: model.json().nullable(),
  builtin: model.boolean().default(false),
  is_active: model.boolean().default(true),
  sort_order: model.number().default(0),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});
