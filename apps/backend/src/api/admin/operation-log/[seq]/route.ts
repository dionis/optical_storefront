import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getOperationLogEntry } from "../../../../lib/operation-log";

/**
 * GET /admin/operation-log/:seq — one operation with its full before and after
 * (already cleaned by the trigger) and the other rows of the same transaction.
 * Owner and superadmin only, like the list.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const entry = await getOperationLogEntry(req.scope, String(req.params.seq ?? ""));
  if (!entry) {
    res.status(404).json({ type: "not_found", reason: "oplog_not_found", message: "Operation not found." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ entry });
}
