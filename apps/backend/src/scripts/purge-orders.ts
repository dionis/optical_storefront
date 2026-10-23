/**
 * Puesta a cero de PEDIDOS antes de salir en vivo (terminal).
 *
 *   npx medusa exec ./src/scripts/purge-orders.js            → solo informa (dry run)
 *   PURGE_CONFIRM=yes npx medusa exec ./src/scripts/purge-orders.js → borra
 *
 * La lógica vive en src/lib/purge-orders.ts (compartida con el panel).
 */
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { purgeOrders } from "../lib/purge-orders";

export { ORDER_DATA_TABLES } from "../lib/purge-orders";

export default async function run({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const report = await purgeOrders(container, process.env.PURGE_CONFIRM === "yes");
  if (report.dry_run) logger.warn("[purge] Para ejecutar: PURGE_CONFIRM=yes npx medusa exec ./src/scripts/purge-orders.js");
}
