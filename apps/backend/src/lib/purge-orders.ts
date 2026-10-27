/**
 * Puesta a cero de PEDIDOS antes de salir en vivo. Lo usan el script
 * `src/scripts/purge-orders.ts` (terminal) y `POST /admin/maintenance/purge-orders`
 * (pestaña Seguridad del panel, con frase de confirmación).
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
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
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
  // punto de venta: ventas, sus pagos y el contador (la siguiente venta de cada tienda vuelve a ser la 000001)
  "pos_sale_payment", "pos_sale", "pos_sale_counter", "pos_tray", "insurance_claim", "discount_approval",
  // numeración de recetas (RX-2026-00001 vuelve a empezar con las recetas borradas)
  "rx_sequence",
];

export interface PurgeReport {
  dry_run: boolean;
  tables: Array<{ table: string; rows: number }>;
  missing_tables: string[];
  total_rows: number;
  private_files: number;
  private_files_deleted?: number;
  sheet?: { orders: number; history: number } | null;
  sheet_error?: string;
}

/**
 * Informe (confirm=false) o borrado real (confirm=true). Lanza solo si la
 * base de datos falla; el bucket y la hoja son best-effort y van en el informe.
 */
export async function purgeOrders(container: MedusaContainer, confirm: boolean): Promise<PurgeReport> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

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
  // Fotos de las monturas que trajo el cliente al punto de venta.
  if (existing.has("pos_sale")) {
    for (const r of await pg("pos_sale").select("own_frame_photo_keys")) {
      const keys = (r as { own_frame_photo_keys: unknown }).own_frame_photo_keys;
      if (Array.isArray(keys)) rxFiles.push(...keys.filter((k): k is string => typeof k === "string" && k.length > 0));
    }
  }
  logger.info(`[purge] ${rxFiles.length} archivo(s) de recetas/probador en el bucket privado.`);

  const report: PurgeReport = {
    dry_run: !confirm,
    tables: counts.map(([table, rows]) => ({ table, rows })),
    missing_tables: missing,
    total_rows: nonEmpty.reduce((a, [, n]) => a + n, 0),
    private_files: rxFiles.length,
  };
  if (!confirm) {
    logger.warn("[purge] DRY RUN — nada borrado.");
    return report;
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
    report.private_files_deleted = ok;
  }

  try {
    report.sheet = await resetSheetData(logger);
    logger.info(`[purge] hoja de Google vaciada (${report.sheet.orders} pedidos, ${report.sheet.history} eventos).`);
  } catch (error) {
    report.sheet = null;
    report.sheet_error = (error as Error).message;
    logger.warn(`[purge] la hoja no se pudo vaciar: ${report.sheet_error}`);
  }
  logger.info("[purge] listo. El Resumen de la hoja queda en cero y el próximo pedido será el #1.");
  return report;
}
