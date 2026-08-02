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
  // Hourly, on the hour. UTC. Idempotent and light (~one upsert per variant),
  // so running it every hour keeps the storefront prices reconciled quickly
  // after any price-book change without meaningful load.
  schedule: "0 * * * *",
};
