import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { readShowcase } from "../../../lib/web-showcase-data";

/**
 * GET /store/web-showcase → { showcase: { mode, brands } }
 *
 * Which brands the web shop shows first as its example frames
 * (lib/web-showcase.ts). Public: only the mode and brand slugs, never who
 * changed it. The ordering (and the random mix, per visit) runs in the
 * browser. Never fails: without a saved showcase, or without the table, it
 * answers the catalogue order. Cacheable one minute.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { mode, brands } = await readShowcase(req.scope);
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({ showcase: { mode, brands } });
}
