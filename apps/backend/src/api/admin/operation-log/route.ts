import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanOplogQuery, listOperationLog, OPLOG_COLUMNS, OPLOG_OPS, OPLOG_SOURCES } from "../../../lib/operation-log";

/**
 * GET /admin/operation-log?from=&to=&store=&table=&op=&actor=&source=&q=
 *   &col[<column>]=&sort=<column>&dir=asc|desc&page=&limit=&export=1
 *
 * The operation log (docs/OPERATION-LOG.md): every write to the database, who
 * made it and from where. Owner and superadmin only — the route is not in the
 * restricted roles' list (lib/staff-roles.ts), so the staff guard stops the rest.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const f = cleanOplogQuery(req.query as Record<string, unknown>);
  if ("reason" in f) {
    res.status(400).json({ type: "invalid_data", reason: f.reason, message: "Invalid filter." });
    return;
  }
  const page = await listOperationLog(req.scope, f);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ...page, columns: OPLOG_COLUMNS, ops: OPLOG_OPS, sources: OPLOG_SOURCES });
}
