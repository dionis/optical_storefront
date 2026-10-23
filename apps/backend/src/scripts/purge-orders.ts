/**
 * Puesta a cero de PEDIDOS antes de salir en vivo.
 *
 *   npx medusa exec ./src/scripts/purge-orders.ts            → solo informa (dry run)
 *   PURGE_CONFIRM=yes npx medusa exec ./src/scripts/purge-orders.ts → borra
 *
 * Borra TODOS los pedidos y lo que cuelga de ellos (carritos, cobros,
 * envíos, recetas y sus archivos del bucket privado, imágenes del probador) y
 * reinicia la numeración (#1). Después vacía la hoja de Google (Pedidos e
 * Historial). NO toca productos, precios, regiones, opciones de envío, clientes,
 * reseñas ni configuración. Pensado para una tienda que solo tiene pedidos de
 * desarrollo; en una tienda con ventas reales esto es destrucción de datos.
 *
 * Hazlo con una copia de seguridad reciente de Postgres (Coolify → Backups).
 */
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createStorageClient, prescriptionBucket, storageConfigured } from "../lib/s3";
import { resetSheetData } from "../lib/gsheet-sync";

/** Tablas que se vacían, hijas antes que padres. Config (reasons, providers,
 *  sets, zones, shipping options…) queda intacta a propósito. */
export const ORDER_DATA_TABLES = [
  // links entre módulos
  "order_cart", "order_payment_collection", "order_fulfillment", "order_promotion",
  "order_claim_payment_collection", "order_exchange_payment_collection", "return_fulfillment",
  "cart_payment_collection", "cart_promotion",
  // devoluciones / reclamaciones / cambios
  "return_item", "return", "order_claim_item_image", "order_claim_item", "order_claim",
  "order_exchange_item", "order_exchange",
  // pedido
  "order_change_action", "order_change", "order_line_item_adjustment", "order_line_item_tax_line",
  "order_shipping_method_adjustment", "order_shipping_method_tax_line", "order_item", "order_shipping",
  "order_transaction", "order_credit_line", "order_summary", "order_line_item", "order_shipping_method",
  "order_address", "order",
  // cobros
  "refund", "capture", "payment", "payment_session", "payment_collection_payment_providers", "payment_collection",
  // envíos
  "fulfillment_label", "fulfillment_item", "fulfillment", "fulfillment_address",
  // carritos
  "credit_line", "cart_line_item_adjustment", "cart_line_item_tax_line", "cart_shipping_method_adjustment",
  "cart_shipping_method_tax_line", "cart_line_item", "cart_shipping_method", "cart_address", "cart",
  // datos de salud (módulo propio)
  "prescription",
];

export default async function purgeOrders({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const confirm = process.env.PURGE_CONFIRM === "yes";

  const existing = new Set(
    (await pg("information_schema.tables").where({ table_schema: "public" }).select("table_name")).map((r: { table_name: string }) => r.table_name)
  );
  const tables = ORDER_DATA_TABLES.filter((t) => existing.has(t));
  const missing = ORDER_DATA_TABLES.filter((t) => !existing.has(t));

  const counts: Array<[string, number]> = [];
  for (const t of tables) {
    const [{ n }] = await pg(t).count<{ n: string }[]>("* as n");
    counts.push([t, Number(n)]);
  }
  const nonEmpty = counts.filter(([, n]) => n > 0);
  logger.info(`[purge] ${tables.length} tablas de pedidos (${missing.length} no existen en esta versión: ${missing.join(", ") || "—"}).`);
  for (const [t, n] of nonEmpty) logger.info(`[purge]   ${t}: ${n}`);
  if (!nonEmpty.length) logger.info("[purge] no hay nada que borrar.");

  // Archivos del bucket privado referenciados por las recetas.
  const rxFiles: string[] = existing.has("prescription")
    ? (await pg("prescription").select("file_url", "tryon_image_url"))
        .flatMap((r: { file_url: string | null; tryon_image_url: string | null }) => [r.file_url, r.tryon_image_url])
        .filter((k): k is string => typeof k === "string" && k.length > 0 && !/^https?:\/\//i.test(k))
    : [];
  logger.info(`[purge] ${rxFiles.length} archivo(s) de recetas/probador en el bucket privado.`);

  if (!confirm) {
    logger.warn("[purge] DRY RUN — nada borrado. Para ejecutar: PURGE_CONFIRM=yes npx medusa exec ./src/scripts/purge-orders.ts");
    return;
  }

  // Un solo TRUNCATE con todas las tablas: Postgres resuelve las claves
  // foráneas entre ellas y RESTART IDENTITY reinicia el display_id (SERIAL),
  // así que el primer pedido real será el #1. Sin CASCADE a propósito: si
  // alguna tabla no listada dependiera de estas, falla con su nombre en vez de
  // arrastrarla en silencio.
  await pg.transaction(async (trx) => {
    await trx.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`);
  });
  logger.info(`[purge] base de datos: ${nonEmpty.reduce((a, [, n]) => a + n, 0)} filas borradas en ${tables.length} tablas; numeración reiniciada.`);

  if (rxFiles.length && storageConfigured()) {
    const s3 = createStorageClient();
    let ok = 0;
    for (const key of rxFiles) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: prescriptionBucket(), Key: key }));
        ok++;
      } catch (error) {
        logger.warn(`[purge] no se pudo borrar ${key}: ${(error as Error).message}`);
      }
    }
    logger.info(`[purge] bucket privado: ${ok}/${rxFiles.length} archivo(s) borrados.`);
  }

  try {
    const sheet = await resetSheetData(logger);
    logger.info(`[purge] hoja de Google vaciada (${sheet.orders} pedidos, ${sheet.history} eventos).`);
  } catch (error) {
    logger.warn(`[purge] la hoja no se pudo vaciar: ${(error as Error).message}`);
  }
  logger.info("[purge] listo. El Resumen de la hoja queda en cero y el próximo pedido será el #1.");
}
