/**
 * One-off / manual price sync — run with:
 *   npx medusa exec ./src/scripts/sync-prices.ts            (applies prices)
 *   npx medusa exec ./src/scripts/sync-prices.ts --dry-run  (report only)
 *
 * Same logic as the 4-hourly job (src/jobs/price-sync.ts); use this to load the
 * correct prices immediately without waiting for the schedule.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { syncPrices } from "../lib/price-sync";

export default async function run({
  container,
  args,
}: {
  container: MedusaContainer;
  args: string[];
}) {
  const dryRun = (args || []).includes("--dry-run");
  const report = await syncPrices(container, { dryRun });
  console.log("[sync-prices] report:", JSON.stringify(report, null, 2));
}
