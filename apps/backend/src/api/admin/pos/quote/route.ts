import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { opticalChange } from "../../../../lib/optical-change";
import { cleanDiscountPct, cleanLines, cleanRxMeta, discountNeedsApproval, type PosLineInput } from "../../../../lib/pos";
import { checkPrescriptions, PosError, rxContexts, rxDesigns, type RxInput } from "../../../../lib/pos-data";
import { quoteWithPromotion } from "../../../../lib/pos-promotion";
import { posHandler, posScope, sellableStore } from "../../../../lib/pos-route";
import { discountLimitFor, getPosSettings } from "../../../../lib/pos-settings";

/**
 * POST /admin/pos/quote — { store, lines, discount_pct?, promotion_id?, promotion_ref?, prescription? }
 *
 * Each line priced in the store, the discount applied and the total, plus
 * whether the discount needs the owner's or a superadmin's approval. With the
 * new prescription it also says whether the lab can make it for those lenses
 * and frames, and with the one they wear, the optical change ("daño óptico",
 * HU-122) for the screen. The same calculation the sale repeats: the till shows it, the
 * sale recomputes it (a client total is never trusted).
 */
interface Body {
  store?: string;
  lines?: PosLineInput[];
  discount_pct?: unknown;
  /** A promotion of the store (lib/promotions.ts) and, for «compre N, lleve M», the paid sale(s). */
  promotion_id?: string | null;
  promotion_ref?: string | null;
  prescription?: RxInput | null;
  worn?: RxInput | null;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const body = (req.body ?? {}) as Body;
    const scope = await posScope(req);
    const store = await sellableStore(req, scope, body.store);
    const cleaned = cleanLines(body.lines);
    if ("reason" in cleaned) throw new PosError(cleaned.reason);
    const discount = cleanDiscountPct(body.discount_pct);
    if ("reason" in discount) throw new PosError(discount.reason);

    const [promoted, settings] = await Promise.all([
      quoteWithPromotion(req.scope, store.id, cleaned.lines, discount.pct, body.promotion_id, body.promotion_ref),
      getPosSettings(req.scope),
    ]);
    const { quote } = promoted;
    const limitPct = discountLimitFor(scope, settings.discount_limits);

    let rx_check: { fulfillable: boolean; warnings: unknown[]; validation?: unknown } | null = null;
    if (body.prescription?.rx) {
      try {
        rx_check = { fulfillable: true, ...checkPrescriptions(req.scope, { new: body.prescription, worn: null }, false, rxContexts(quote), rxDesigns(quote)) };
      } catch (e) {
        if (e instanceof PosError && e.reason === "invalid_prescription") rx_check = { fulfillable: false, warnings: [], validation: e.extra.validation };
        else throw e;
      }
    }

    let optical_change = null;
    if (body.worn?.rx?.od && body.worn.rx.os && body.prescription?.rx?.od && body.prescription.rx.os) {
      const meta = cleanRxMeta(body.worn as never);
      optical_change = opticalChange(
        { od: body.worn.rx.od, os: body.worn.rx.os, rx_date: "reason" in meta ? null : meta.rx_date },
        { od: body.prescription.rx.od, os: body.prescription.rx.os },
        { thresholds: settings.optical_thresholds }
      );
    }

    res.json({
      quote,
      optical_change,
      limit_pct: limitPct,
      // A promotion's percentage was set up by the owner: it never asks for approval.
      needs_approval: promoted.discount_source === "promotion" ? false : discountNeedsApproval({ isAdmin: scope.is_admin, pct: quote.discount_pct, limitPct, belowMinimum: quote.below_minimum }),
      promotion: promoted.promotion,
      discount_source: promoted.discount_source,
      rx_check,
    });
  });
}
