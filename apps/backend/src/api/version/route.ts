import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

const STARTED_AT = new Date().toISOString();

/**
 * Qué versión del backend está corriendo. `SOURCE_COMMIT` lo inyecta Coolify
 * como build arg (ver Dockerfile); sin él, al menos se ve cuándo arrancó el
 * proceso. Público y sin datos sensibles, igual que /health.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json({
    commit: process.env.SOURCE_COMMIT || null,
    started_at: STARTED_AT,
    gsheet: Boolean(process.env.GSHEET_FILE_URL || process.env.GSHEET_SPREADSHEET_ID),
  });
}
