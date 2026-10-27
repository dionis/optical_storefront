import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { searchCustomers } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";

/**
 * GET /admin/pos/customers?q= — search by name, email or phone (HU-22).
 * Customers belong to the business, not to a store: a customer of Op1 is found
 * at Op2 too (HU-70), so the search is not limited by store. The till shows
 * the match first so nobody is registered twice (HU-87).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const q = String((req.query as Record<string, unknown>).q ?? "");
    res.json({ customers: await searchCustomers(req.scope, q) });
  });
}
