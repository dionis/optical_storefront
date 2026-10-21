import type { MedusaContainer } from "@medusajs/framework/types";
import { applySheetEdits } from "../lib/gsheet-sync";
import { transitionOrderStage } from "../lib/order-stage-transition";

/**
 * Vigilante de la hoja de Google: cada minuto lee las columnas editables de la
 * tabla "Pedidos" (Estado y Guía) y aplica a la base de datos lo que el dueño
 * cambió, con las mismas reglas, correo al cliente e historial que el panel.
 * Lo que no procede se revierte en la hoja con el motivo en Notas.
 */
export default async function gsheetWatchJob(container: MedusaContainer): Promise<void> {
  await applySheetEdits(container, async (orderId, stage, tracking) => {
    await transitionOrderStage(container, orderId, {
      stage,
      actorId: "gsheet",
      trackingNumber: tracking || undefined,
    });
  });
}

export const config = {
  name: "gsheet-watch",
  schedule: "* * * * *",
};
