/**
 * A promotion at the till (lib/promotions.ts): the quote and the sale call
 * this so both price it the same way. Without a promotion it is just
 * quoteSale with the seller's discount.
 */
import { purchaseSummary } from "./patient-purchases";
import type { MedusaContainer } from "@medusajs/framework/types";
import { PosError, quoteSale, type Quote } from "./pos-data";
import type { PosLine } from "./pos";
import { applyPromotion, saleDiscountPct, type AppliedPromotion } from "./promotions";
import { livePromotion } from "./promotions-data";

export interface PromotedQuote {
  quote: Quote;
  promotion: AppliedPromotion | null;
  /** Which percentage is in the price: the promotion's, the seller's discount, or none. */
  discount_source: "promotion" | "discount" | null;
}

export async function quoteWithPromotion(
  container: MedusaContainer,
  establishmentId: string,
  lines: PosLine[],
  manualPct: number,
  promotionId: unknown,
  ref: unknown,
  /** The patient of the sale: a promotion «desde la N.ª compra» counts their purchases. */
  customerId: string | null = null
): Promise<PromotedQuote> {
  const id = typeof promotionId === "string" && promotionId.trim() ? promotionId.trim() : null;
  const first = await quoteSale(container, establishmentId, lines, manualPct);
  if (!id) return { quote: first, promotion: null, discount_source: manualPct > 0 ? "discount" : null };
  const promo = await livePromotion(container, id, establishmentId);
  // Switched off, out of its dates or not for this store since the screen loaded.
  if (!promo) throw new PosError("promo_not_available", 409);
  const prior = promo.min_purchases ? (await purchaseSummary(container, customerId)).purchases : 0;
  const a = applyPromotion(promo, { listCents: first.list_cents, ref, priorPurchases: prior });
  if ("reason" in a) throw new PosError(a.reason, 422, a.min !== undefined ? { min: a.min } : {});
  const { pct, source } = saleDiscountPct(manualPct, a.applied.pct);
  const quote = pct === manualPct ? first : await quoteSale(container, establishmentId, lines, pct);
  return { quote, promotion: { ...a.applied, priced: source === "promotion" }, discount_source: source };
}
