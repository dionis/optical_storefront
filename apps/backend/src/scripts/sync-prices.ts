/**
 * One-off / manual price sync — run with:
 *   npx medusa exec ./src/scripts/sync-prices.ts                      (applies prices)
 *   PRICE_SYNC_DRY_RUN=1 npx medusa exec ./src/scripts/sync-prices.ts (report only)
 *
 * The dry run is an env var because `medusa exec` rejects unknown flags.
 *
 * Same logic as the 4-hourly job (src/jobs/price-sync.ts); use this to load the
 * correct prices immediately without waiting for the schedule.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { syncPrices } from "../lib/price-sync";

export default async function run({ container }: { container: MedusaContainer }) {
  const dryRun = process.env.PRICE_SYNC_DRY_RUN === "1";
  const report = await syncPrices(container, { dryRun });
  console.log("[sync-prices] report:", JSON.stringify(report, null, 2));
}
