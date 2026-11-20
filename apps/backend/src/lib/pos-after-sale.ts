import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { emitAlert } from "./alerts-data";
import { emailReceipt } from "./pos-documents";
import { getSale, type CreatedSale, type Quote } from "./pos-data";

export interface AfterSaleInput {
  sale: Pick<CreatedSale, "id" | "number" | "total">;
  quote: Pick<Quote, "discount_pct" | "below_minimum">;
  store: { id: string; code: string; name: string };
  sellerId: string | null;
  sellerCode: string | null;
  notifyEmail: boolean;
  /** Receipt with photos and prescription: only exactly true, decided sale by sale. */
  receiptDetail: boolean;
  /** How long the till waited for its answer, for the timing log. */
  responseMs: number;
}

/** Fastest of three `select 1`: what each query costs this server, without a slow outlier. */
async function dbPingMs(container: MedusaContainer): Promise<number> {
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await pg.raw("select 1");
    best = Math.min(best, Date.now() - t);
  }
  return best;
}

/**
 * What a sale still has to do once it is recorded: the receipt (HU-27), the
 * alerts (E7) and a timing line for the logs. Runs after the till has its answer
 * so the seller never waits on an email provider. Never rejects: a failed mail
 * is logged and can be resent from the sale; if the process restarts mid-way the
 * unsent mails are lost, which is the price of not holding the till.
 */
export async function runAfterSale(container: MedusaContainer, input: AfterSaleInput): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const { sale, quote, store } = input;
  const started = Date.now();

  if (input.notifyEmail) {
    try {
      const row = await getSale(container, sale.id);
      if (row) await emailReceipt(container, row, { detailed: input.receiptDetail, actorId: input.sellerId });
    } catch (e) {
      logger.warn(`[pos] sale ${sale.number}: receipt not sent, resend it from the sale: ${(e as Error).message}`);
    }
  }

  // emitAlert logs its own failures and never throws.
  const data = { number: sale.number, total: sale.total, discount_pct: quote.discount_pct, store_code: store.code, store_name: store.name, seller_code: input.sellerCode };
  const base = { establishment_id: store.id, seller_id: input.sellerId, data };
  await emitAlert(container, { ...base, event: "sale.created", key: `sale:${sale.id}` });
  if (quote.discount_pct > 0) await emitAlert(container, { ...base, event: "discount.applied", key: `discount:${sale.id}` });
  if (quote.below_minimum) await emitAlert(container, { ...base, event: "sale.below_min", key: `belowmin:${sale.id}` });

  try {
    const ping = await dbPingMs(container);
    logger.info(`[pos] sale ${sale.number} timing: response ${input.responseMs}ms, after response ${Date.now() - started}ms, db ping ${ping}ms`);
  } catch (e) {
    logger.warn(`[pos] sale ${sale.number}: could not measure the database: ${(e as Error).message}`);
  }
}
