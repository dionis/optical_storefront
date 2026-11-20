import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { loadLensMatrixForStore, type LensMatrixPayload } from "../../../../lib/lens-matrix";
import { posHandler, posScope, sellableStore } from "../../../../lib/pos-route";
import { applyLensMatrixDiscounts, indexItemDiscounts } from "../../../../lib/price-matrix";
import { loadItemDiscountsPg } from "../../../../lib/price-matrix-data";

export interface PosLensMatrixResponse extends LensMatrixPayload {
  /** The store whose variations are applied; null = the master list. */
  store: string | null;
}

/**
 * GET /admin/pos/lens-matrix[?store=est_…] — the lens price list the till
 * picks from: the same payload as the public GET /store/lens-config/matrix
 * (designs, materials, `base_prices` with one cell per finish, photochromics,
 * ARs, treatment matrix), built by lib/lens-matrix.ts and never carrying the
 * lab's `cost_cents`. With `store`, each base / photochromic / AR cell is that
 * store's price (its exact overrides and its % over the master, as the quote
 * applies them); without it, the master. Every POS role; the store must be
 * one the user may sell in (`forbidden_store` / `store_not_found` otherwise).
 *
 * With `store`, the owner's per-article promotions of that store
 * (store_item_discount, «Productos y precios») are applied too, the way the
 * quote applies them: a discounted cell carries the reduced price in its usual
 * field plus `price_before_cents` / `discount_pct` (photochromics: per category,
 * `price_before` / `discount_pct` objects) — lib/price-matrix.ts
 * `applyLensMatrixDiscounts`. A cell without a discount is unchanged.
 *
 * The panel used to read the public route only when VITE_USE_MEDUSA was on,
 * which the deployed builds never set, so the till showed the bundled 2026
 * list and the finish toggle never reflected the owner's edits. This route
 * needs no publishable key — the admin session is enough.
 *
 * No cache headers on purpose: a price the owner just changed must be the
 * next one the till sees. The panel's own cache invalidates it on every write
 * to /admin/pricing/lenses.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const q = req.query as Record<string, string | undefined>;
    const scope = await posScope(req);
    const store = q.store ? await sellableStore(req, scope, q.store) : null;
    const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    const [base, discounts] = await Promise.all([loadLensMatrixForStore(pg, store?.id ?? null), loadItemDiscountsPg(pg, store?.id ?? null)]);
    const matrix = applyLensMatrixDiscounts(base, indexItemDiscounts(discounts), store?.id ?? null);
    const body: PosLensMatrixResponse = { ...matrix, store: store?.id ?? null };
    res.setHeader("Cache-Control", "no-store");
    res.json(body);
  });
}
