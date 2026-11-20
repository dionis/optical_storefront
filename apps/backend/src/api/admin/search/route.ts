import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { omniSearch, type OmniSearchResponse } from "../../../lib/omni-search";
import { PosError } from "../../../lib/pos-data";
import { posHandler, posScope } from "../../../lib/pos-route";

export type { OmniSearchResponse };

/**
 * GET /admin/search?q=<text>&limit=<n> — the panel's single search bar.
 *
 * Answers with grouped suggestions for whatever the owner typed: a sale number
 * (`Op1-000123` or just `123`), an order number (`#1024`), a patient's name or
 * phone, a seller, a store, or a frame's model or SKU. Empty groups are left
 * out and the server does NOT decide where a result navigates to — it returns
 * the `kind` and the `id` and the panel takes it from there.
 *
 * It is an autocomplete: a `q` under two characters answers with no groups
 * without touching the database, and each group is one small bounded query.
 * `limit` is the cap per group (5 by default, 10 at most).
 *
 * Everything is scoped by role on the server (lib/omni-search.ts): a seller
 * finds only their own sales and the patients of those sales and no colleague
 * or store at all; a supervisor or manager only their stores'; owner and
 * superadmin everything. Clinical data is never part of a result.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    // A user whose assignments were all deactivated has no role: no search either.
    if (!scope.role) throw new PosError("forbidden_role", 403);
    const q = req.query as Record<string, unknown>;
    const body: OmniSearchResponse = await omniSearch(req.scope, scope, { q: q.q, limit: q.limit });
    res.json(body);
  });
}
