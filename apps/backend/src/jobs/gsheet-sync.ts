/**
 * Job programado: cada 30 minutos pone al día la hoja de Google (pestañas,
 * estilo, resumen ejecutivo) y da de alta los pedidos que falten en la tabla.
 * Sin GSHEET_* configurado es un no-op. Ver src/lib/gsheet-sync.ts.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { backfillOrdersToSheet } from "../lib/gsheet-sync";

export default async function gsheetSyncJob(container: MedusaContainer) {
  await backfillOrdersToSheet(container);
}

export const config = {
  name: "gsheet-sync",
  schedule: "*/30 * * * *",
};
