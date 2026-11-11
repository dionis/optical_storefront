import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { loadLensMatrix, loadLensMatrixForStore } from "../../../../lib/lens-matrix";
import { onlineStore } from "../../../../lib/online-store";
import { applyLensMatrixDiscounts, indexItemDiscounts } from "../../../../lib/price-matrix";
import { loadItemDiscountsPg } from "../../../../lib/price-matrix-data";

/**
 * GET /store/lens-config/matrix
 * The full editable 2026 price list (designs × materials base matrix + photochromic
 * + AR options) that drives the storefront lens wizard. Read-only; the total is
 * always recomputed server-side via /store/lens-config/quote.
 *
 * The ONLINE STORE's list when the owner has one (lib/online-store.ts): its own
 * cells, its % over the master and its promotions, exactly as its till reads
 * them from GET /admin/pos/lens-matrix?store=…. Without one, the master list.
 * Both are built by lib/lens-matrix.ts, which never lets `cost_cents` through.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const store = await onlineStore(req.scope);
  if (!store) {
    res.json(await loadLensMatrix(pg));
    return;
  }
  const [base, discounts] = await Promise.all([loadLensMatrixForStore(pg, store.id), loadItemDiscountsPg(pg, store.id)]);
  res.json(applyLensMatrixDiscounts(base, indexItemDiscounts(discounts), store.id));
}
