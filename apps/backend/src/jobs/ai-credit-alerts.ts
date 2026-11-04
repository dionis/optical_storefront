/**
 * Scheduled job: every 15 minutes, send the low-balance alerts that tripped
 * (once per funding cycle) and report "out of credit" refusals (at most every
 * 6 hours per provider). Idempotent — see src/lib/ai-usage-data.ts.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { runAiCreditAlerts } from "../lib/ai-usage-data";

export default async function aiCreditAlertsJob(container: MedusaContainer) {
  await runAiCreditAlerts(container);
}

export const config = {
  name: "ai-credit-alerts",
  schedule: "*/15 * * * *",
};
