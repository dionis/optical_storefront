/**
 * «GRADUACIÓN PENDIENTE» (owner, 15-nov-2026).
 *
 * How the counter really works: the patient picks the frame and the lenses
 * (a high-end progressive, photochromic, anti-reflective), pays a deposit and
 * takes the receipt — and only THEN goes to the clinic for the exam, which
 * can take two or three hours. The prescription arrives later (another
 * colleague sends it). Until now the till refused to finish a sale with
 * lenses and no prescription, so the sale could not be saved at the moment it
 * happened.
 *
 * Now the till can finish it with the prescription pending:
 *   - the sale (`pos_sale.rx_pending`), the order (`metadata.rx_pending`) and
 *     each lens line (`metadata.rx_pending`) say so; the lens design chosen is
 *     kept as sold (a progressive is a progressive even before the ADD is
 *     known);
 *   - the LAB TICKET cannot be printed and the order cannot go to the lab
 *     (`rx_pending`): a lab order without a prescription is how a wrong pair
 *     gets cut;
 *   - the prescription is added from the sale (Corregir → Receta, the same
 *     form as at the till), checked against the lens design sold exactly like
 *     at the till, gets the next Rx number, is linked to every lens line, and
 *     the pending mark goes.
 *
 * This file holds that last step; lib/pos-sale-admin.ts updateSaleDetails
 * calls it when the sale has no prescription yet.
 */
import type { Clinical } from "./visual-acuity";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import type { Prescription } from "@eyewear/shared";
import { insertLatePrescription, PosError, stampOrder } from "./pos-data";

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/** A line that carries lenses (and so needs a prescription). Pure. */
export const lineHasLenses = (metadata: Record<string, unknown> | null | undefined): boolean => {
  const code = (metadata?.lens_config as { design_code?: string } | undefined)?.design_code;
  return Boolean(code) && code !== "frame-only";
};

/** Whether a sale is still waiting for its prescription, from its order's lines. Pure. */
export function waitingForRx(items: ReadonlyArray<{ metadata?: Record<string, unknown> | null }>): boolean {
  const lens = items.filter((i) => lineHasLenses(i.metadata));
  return lens.length > 0 && lens.some((i) => !i.metadata?.prescription_id);
}

/**
 * Writes the prescription that came later and links it to every lens line of
 * the order that has none. The caller has already checked it
 * (checkPrescriptions) against the designs sold.
 */
export async function attachLatePrescription(
  container: MedusaContainer,
  args: { saleId: string; orderId: string; customerId: string | null; rx: Prescription; rxDate: string | null; clinical?: Clinical | null }
): Promise<{ prescriptionId: string; rxNumber: string; lines: number }> {
  if (!args.customerId) throw new PosError("customer_not_found", 404);
  const { id, rxNumber } = await insertLatePrescription(container, args.customerId, args.rx, args.rxDate, args.clinical ?? null);
  const pg = pgOf(container);
  const res = (await pg.raw(
    `UPDATE order_line_item li
        SET metadata = COALESCE(li.metadata, '{}'::jsonb) || jsonb_build_object('prescription_id', ?::text, 'rx_pending', false),
            updated_at = now()
       FROM order_item oi
      WHERE oi.item_id = li.id
        AND oi.order_id = ?
        AND oi.deleted_at IS NULL
        AND li.deleted_at IS NULL
        AND COALESCE(li.metadata->'lens_config'->>'design_code', 'frame-only') <> 'frame-only'
        AND COALESCE(li.metadata->>'prescription_id', '') = ''
  RETURNING li.id`,
    [id, args.orderId]
  )) as { rows: Array<{ id: string }> };
  // Medusa keeps a copy of the line's metadata on the order item (`order_item.metadata`), and that copy is
  // what `query.graph({ entity: "order", fields: ["items.*"] })` returns: both are written, or the
  // documents, the board and the dashboards would still read the line as pending.
  await pg.raw(
    `UPDATE order_item oi
        SET metadata = COALESCE(oi.metadata, '{}'::jsonb) || jsonb_build_object('prescription_id', ?::text, 'rx_pending', false),
            updated_at = now()
       FROM order_line_item li
      WHERE oi.item_id = li.id
        AND oi.order_id = ?
        AND oi.deleted_at IS NULL
        AND COALESCE(COALESCE(oi.metadata, li.metadata)->'lens_config'->>'design_code', 'frame-only') <> 'frame-only'
        AND COALESCE(oi.metadata->>'prescription_id', '') = ''`,
    [id, args.orderId]
  );
  await pg("pos_sale").where({ id: args.saleId }).update({ rx_pending: false, updated_at: new Date() });
  await stampOrder(container, args.orderId, { rx_pending: false });
  return { prescriptionId: id, rxNumber, lines: res.rows.length };
}
