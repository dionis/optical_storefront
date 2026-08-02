/**
 * Scheduled job: every 4 hours, reconcile catalog prices with the wholesale
 * price sheet + pricing rules. Idempotent — see src/lib/price-sync.ts.
 *
 * Runs in the Medusa worker. Keeps selling prices stable and consistent as the
 * catalog changes, and logs any product that lacks a sheet price.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { syncPrices } from "../lib/price-sync";

export default async function priceSyncJob(container: MedusaContainer) {
  await syncPrices(container);
}

export const config = {
  name: "price-sync",
  // Every 4 hours, on the hour (00:00, 04:00, 08:00, ...). UTC.
  schedule: "0 */4 * * *",
};
