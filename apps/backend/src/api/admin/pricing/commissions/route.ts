import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../lib/audit";
import { mirrorPricesToSheet } from "../../../../lib/gsheet-sync";
import { loadPricingOverview } from "../../../../lib/pricing-overview";
import { findSellerById, parseCommissionPct, sellerService } from "../../../../lib/sellers";
import { saveDefaultCommissionPct } from "../../../../lib/store-cost-toggle";

/**
 * POST /admin/pricing/commissions
 *   { default_pct?, sellers?: [{ id, pct }] }
 *
 * The commissions, in the same panel as the costs they are part of — the
 * owner's "in the same place: commissions, fixed costs, variable costs, taxes,
 * so the owner knows where to go". `default_pct` is what a new seller starts
 * with; `sellers` sets a person's own percentage (`seller.commission_pct`,
 * which is what the cost sheet of every sale already reads).
 *
 * A commission is a real cost of each sale: changing one re-computes the past
 * too, exactly as the Executive panel warns. Audited per seller.
 */
interface Body {
  default_pct?: unknown;
  sellers?: Array<{ id?: unknown; pct?: unknown }>;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const actorId = req.auth_context?.actor_id ?? null;

  if (body.default_pct === undefined && !Array.isArray(body.sellers)) {
    res.status(422).json({ type: "invalid_data", reason: "nothing_to_save", message: "Send default_pct or sellers." });
    return;
  }
  let defaultPct: number | null = null;
  if (body.default_pct !== undefined && body.default_pct !== null) {
    defaultPct = parseCommissionPct(body.default_pct);
    if (defaultPct === null) {
      res.status(422).json({ type: "invalid_data", reason: "commission_invalid", message: "Commission must be 0–100." });
      return;
    }
  }
  const rows: Array<{ id: string; pct: number }> = [];
  for (const entry of Array.isArray(body.sellers) ? body.sellers : []) {
    const id = entry?.id == null ? "" : String(entry.id).trim();
    const pct = parseCommissionPct(entry?.pct);
    if (!id) {
      res.status(422).json({ type: "invalid_data", reason: "bad_seller", message: "Each seller needs an id." });
      return;
    }
    if (pct === null) {
      res.status(422).json({ type: "invalid_data", reason: "commission_invalid", message: "Commission must be 0–100." });
      return;
    }
    rows.push({ id, pct });
  }

  try {
    if (defaultPct !== null) {
      await saveDefaultCommissionPct(req.scope, defaultPct, actorId);
      await recordAudit(req.scope, {
        actorId,
        action: "settings.change",
        entity: "commission_default",
        entityId: "default_commission_pct",
        after: { pct: defaultPct },
      });
    }
    if (rows.length) {
      const svc = sellerService(req.scope);
      for (const row of rows) {
        const current = await findSellerById(req.scope, row.id);
        if (!current) {
          res.status(404).json({ type: "not_found", reason: "seller_not_found", message: `No seller ${row.id}.` });
          return;
        }
        if (Number(current.commission_pct) === row.pct) continue;
        await svc.updateSellers([{ id: row.id, commission_pct: row.pct }] as never);
        await recordAudit(req.scope, {
          actorId,
          action: "settings.change",
          entity: "seller",
          entityId: row.id,
          establishmentId: current.establishment_id ?? null,
          before: { commission_pct: Number(current.commission_pct) || 0 },
          after: { commission_pct: row.pct },
        });
      }
    }
    const overview = await loadPricingOverview(req.scope, null);
    logger.info(`[pricing] commissions saved (${rows.length} sellers) by ${actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ commissions: overview.commissions });
  } catch (error) {
    logger.error(`[pricing] commissions save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the commissions." });
  }
}
