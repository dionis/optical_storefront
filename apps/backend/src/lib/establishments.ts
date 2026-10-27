import type { MedusaContainer } from "@medusajs/framework/types";
import { createSalesChannelsWorkflow } from "@medusajs/medusa/core-flows";
import { ESTABLISHMENT_MODULE } from "../modules/establishment";
import type EstablishmentModuleService from "../modules/establishment/service";

/**
 * Stores (establecimientos): code assignment and creation.
 *
 * Codes are Op1, Op2, Op3… in creation order (owner's decision). The next code
 * is one past the highest ever used, so deactivating Op2 never hands "Op2" to a
 * different store later: old receipts and lab tickets keep pointing at the
 * store that issued them.
 */

export const CODE_PREFIX = "Op";

export function nextEstablishmentCode(existing: string[]): string {
  let max = 0;
  for (const code of existing) {
    const m = new RegExp(`^${CODE_PREFIX}(\\d+)$`).exec(code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${CODE_PREFIX}${max + 1}`;
}

/** Trimmed text or null; `max` caps what a form can store. */
export function cleanText(value: unknown, max: number): string | null {
  const s = typeof value === "string" ? value.trim().slice(0, max) : "";
  return s ? s : null;
}

export interface EstablishmentRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  sales_channel_id: string | null;
  is_active: boolean;
  created_at: string;
}

export async function listEstablishments(container: MedusaContainer): Promise<EstablishmentRow[]> {
  const svc = container.resolve<EstablishmentModuleService>(ESTABLISHMENT_MODULE);
  const rows = await svc.listEstablishments({}, { take: 500, order: { created_at: "ASC" } });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    address: r.address ?? null,
    phone: r.phone ?? null,
    sales_channel_id: r.sales_channel_id ?? null,
    is_active: Boolean(r.is_active),
    created_at: String(r.created_at),
  }));
}

/**
 * Creates the store with the next code and its own Medusa sales channel. The
 * code is read from every row ever created (soft-deleted included), matching
 * the "never reused" rule and the all-rows unique index.
 */
export async function createEstablishment(
  container: MedusaContainer,
  input: { name: string; address: string | null; phone: string | null; actorId: string | null }
): Promise<EstablishmentRow> {
  const svc = container.resolve<EstablishmentModuleService>(ESTABLISHMENT_MODULE);
  const all = await svc.listEstablishments({}, { take: 1000, withDeleted: true });
  const code = nextEstablishmentCode(all.map((r) => r.code));

  const { result } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [{ name: `${code} · ${input.name}`, description: `Point of sale of store ${code}` }],
    },
  });

  const created = await svc.createEstablishments({
    code,
    name: input.name,
    address: input.address,
    phone: input.phone,
    sales_channel_id: result[0]?.id ?? null,
    created_by: input.actorId,
  });
  const [row] = (await listEstablishments(container)).filter((r) => r.id === created.id);
  return row;
}
