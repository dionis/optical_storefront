import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { deriveOrderProgress, stageIndex } from "./order-status";
import type { SaleRow } from "./pos-data";

export interface ReadySale {
  id: string;
  number: string;
  balance: number;
  stage: string;
  seller_code: string | null;
}

/**
 * Open counter sales whose order is back from the lab (shipped or later) and
 * not yet handed over — the customer can be called (HU-52). Used by a seller's
 * own panel and by the store status.
 */
export async function readyToHand(container: MedusaContainer, sales: SaleRow[]): Promise<ReadySale[]> {
  const open = sales.filter((s) => s.status === "completed" && !s.delivered_at && s.order_id);
  if (!open.length) return [];
  const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "status", "payment_status", "fulfillment_status", "created_at", "metadata", "items.metadata", "fulfillments.*"],
    filters: { id: open.map((s) => s.order_id as string) },
  });
  const stageOf = new Map((data as Array<Record<string, unknown>>).map((o) => [String(o.id), deriveOrderProgress(o as never).stage]));
  return open
    .filter((s) => {
      const st = stageOf.get(s.order_id as string);
      return st && stageIndex(st) >= stageIndex("shipped");
    })
    .map((s) => ({ id: s.id, number: s.number, balance: s.balance, stage: stageOf.get(s.order_id as string) as string, seller_code: s.seller_code }));
}
