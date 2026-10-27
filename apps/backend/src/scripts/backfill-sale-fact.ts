/**
 * Rebuilds the sale_fact projection for every existing order, so the
 * dashboards show history from the first day (web orders land in the "online"
 * channel with no seller). Idempotent: each order's rows are replaced.
 *
 *   npx medusa exec ./src/scripts/backfill-sale-fact.ts
 */
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { projectOrder } from "../lib/sale-facts";

export default async function backfillSaleFact({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  let offset = 0;
  let orders = 0;
  let lines = 0;
  for (;;) {
    const { data } = await query.graph({ entity: "order", fields: ["id"], pagination: { skip: offset, take: 200, order: { created_at: "ASC" } } });
    if (!data.length) break;
    for (const o of data as Array<{ id: string }>) {
      lines += await projectOrder(container, o.id);
      orders++;
    }
    offset += data.length;
  }
  logger.info(`[backfill-sale-fact] ${orders} orders, ${lines} lines projected.`);
}
