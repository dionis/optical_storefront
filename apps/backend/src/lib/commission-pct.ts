/**
 * The seller commission % of a sold line — ONE precedence for every screen
 * that pays or shows a commission (Ejecutivo `lib/sales-insights.ts`, the store
 * result `lib/store-pnl.ts` / `lib/financial-statement.ts`, the start map
 * `lib/start-map.ts` and the seller's own panel `/admin/sales-analytics/me`):
 *
 *   1. the person's profile % (`staff_profile.commission_pct`), when set;
 *   2. their seller record % (`seller.commission_pct`, by user or by code);
 *   3. the owner's DEFAULT commission («Comisión por defecto» in Productos y
 *      precios → Reglas y comisiones, `store_pricing_setting.default_commission_pct`)
 *      when the line HAS a seller (a panel user sold it) but neither 1 nor 2
 *      gives a %;
 *   4. otherwise none (nobody to pay: a sale without seller, or a referral
 *      code that matches no seller record).
 *
 * Until 7-nov-2026 the default was shown but applied nowhere (QA: 7 % on the
 * screen, Sellers' form starting at 10 %): a counter user without a profile %
 * earned 0 everywhere. Pure.
 */
export function resolveCommissionPct(
  own: number | null | undefined,
  record: number | null | undefined,
  hasSeller: boolean,
  defaultPct: number | null | undefined
): number | null {
  const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(Number(v));
  if (ok(own)) return Number(own);
  if (ok(record)) return Number(record);
  return hasSeller && ok(defaultPct) ? Number(defaultPct) : null;
}

/** A line as the resolver reads it. */
export interface CommissionLineLike {
  seller_id: string | null;
  seller_code: string | null;
}

/**
 * The resolver every loader builds once per request: profile by user id,
 * seller record by code, and the default. Pure given its maps.
 */
export function commissionResolverOf(
  profiles: Map<string, { commission_pct: number | null }>,
  sellerByCode: Map<string, { commission_pct: number }>,
  defaultPct: number | null
): (l: CommissionLineLike) => number | null {
  return (l) => {
    const own = l.seller_id ? profiles.get(l.seller_id)?.commission_pct ?? null : null;
    const record = l.seller_code ? sellerByCode.get(l.seller_code)?.commission_pct ?? null : null;
    return resolveCommissionPct(own, record, Boolean(l.seller_id), defaultPct);
  };
}
