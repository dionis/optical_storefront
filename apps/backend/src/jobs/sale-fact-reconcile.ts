/**
 * Scheduled job: every 6 hours, project the recent orders (last 90 days) that
 * have no `sale_fact` rows — a projection lost to a failed write or a restart
 * — so the dashboards never silently miss a sale. Idempotent and never
 * throws — see src/lib/sale-facts.ts reconcileSaleFacts.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { reconcileSaleFacts } from "../lib/sale-facts";

export default async function saleFactReconcileJob(container: MedusaContainer) {
  await reconcileSaleFacts(container);
}

export const config = {
  name: "sale-fact-reconcile",
  // Minute 20 of every sixth hour, away from the hourly alerts (:05) and the 15-minute jobs.
  schedule: "20 */6 * * *",
};
