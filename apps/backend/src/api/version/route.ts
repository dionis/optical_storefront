import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

const STARTED_AT = new Date().toISOString();

/**
 * What this backend can do, for a storefront that may be newer than it. The admin
 * panel only shows the multi-store tabs (point of sale, stores, sales, alerts,
 * store costs…) when "multistore" is listed: a backend built before that work has
 * none of their routes, and the tabs would only show errors.
 */
const FEATURES = ["multistore"] as const;

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
    features: FEATURES,
  });
}
