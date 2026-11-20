import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getRun } from "../../../../../lib/catalog-sync-data";

/** GET /admin/catalog-sync/runs/:id — one run in full, log included. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const run = await getRun(req.scope, String(req.params.id ?? ""));
  if (!run) {
    res.status(404).json({ type: "not_found", reason: "run_not_found", message: "Run not found." });
    return;
  }
  res.json({ run });
}
