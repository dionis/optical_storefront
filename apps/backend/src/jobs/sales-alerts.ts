/**
 * Scheduled job: every hour, send the alert summaries that are due (every N
 * hours, daily at a time, weekly), the daily digest, and "store without
 * sales". Idempotent — see src/lib/alerts-data.ts.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { runAlertsJob } from "../lib/alerts-data";

export default async function salesAlertsJob(container: MedusaContainer) {
  await runAlertsJob(container);
}

export const config = {
  name: "sales-alerts",
  // Minute 5 of every hour. Schedules are evaluated in the store's local time.
  schedule: "5 * * * *",
};
