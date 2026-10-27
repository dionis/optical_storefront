import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanLines, type PosLineInput } from "../../../../lib/pos";
import { PosError, quoteSale } from "../../../../lib/pos-data";
import { posHandler, posScope, sellableStore } from "../../../../lib/pos-route";

/**
 * POST /admin/pos/quote — { store, lines } → each line priced in the store and
 * the total. The same calculation the sale uses; the till shows it, the sale
 * recomputes it (a client total is never trusted).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const body = (req.body ?? {}) as { store?: string; lines?: PosLineInput[] };
    const store = await sellableStore(req, await posScope(req), body.store);
    const cleaned = cleanLines(body.lines);
    if ("reason" in cleaned) throw new PosError(cleaned.reason);
    res.json({ quote: await quoteSale(req.scope, store.id, cleaned.lines) });
  });
}
