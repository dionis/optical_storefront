/**
 * Scheduled job: every hour, keep the operation log (docs/OPERATION-LOG.md)
 * covering every table — a table a later migration created gets its trigger
 * (`oplog_attach_all()`, idempotent). With `OPLOG_RETENTION_DAYS` set (≥ 90),
 * rows older than that are removed in small batches; unset, nothing is ever
 * removed. Never throws.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { maintainOperationLog } from "../lib/operation-log";

export default async function operationLogMaintainJob(container: MedusaContainer) {
  await maintainOperationLog(container);
}

export const config = {
  name: "operation-log-maintain",
  // Minute 35 of every hour, away from the hourly alerts (:05) and the 15-minute jobs.
  schedule: "35 * * * *",
};
