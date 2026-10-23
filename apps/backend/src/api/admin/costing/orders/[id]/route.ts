import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  costSheetForOrder,
  loadCostingContext,
  readStoredSheet,
  saveStoredSheet,
  type StoredCostSheet,
} from "../../../../../lib/costing";
import { fetchBoardOrder } from "../../../../../lib/order-board";
import { syncOrderToSheet } from "../../../../../lib/gsheet-sync";

/**
 * Cost sheet of ONE order.
 *
 *   GET /admin/costing/orders/:id — computed from the rules (plus the seller's
 *                                   commission), or the owner's stored lines.
 *                                   The body is the `CostSheet` itself (gross,
 *                                   deductions, net base, materials, percent
 *                                   items, commission, cost, margin, target
 *                                   and suggested price — see lib/costing)
 *                                   plus the order's identity.
 *   PUT /admin/costing/orders/:id — { lines: [{key,label,amount,qty}] } stores
 *                                   a manual override; { reset: true } removes
 *                                   it. Either way the Google Sheet row is
 *                                   refreshed ("costo" event) and the sheet is
 *                                   returned.
 */
const MAX_MANUAL_LINES = 60;

async function readOrderMetadata(req: AuthenticatedMedusaRequest, id: string): Promise<Record<string, unknown>> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: "order", fields: ["id", "metadata"], filters: { id } });
  return ((data?.[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata ?? {}) as Record<string, unknown>;
}

async function respondWithSheet(req: AuthenticatedMedusaRequest, res: MedusaResponse, id: string): Promise<void> {
  const order = await fetchBoardOrder(req.scope, id);
  if (!order) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: `Order '${id}' not found.` });
    return;
  }
  const metadata = await readOrderMetadata(req, id);
  const ctx = await loadCostingContext(req.scope);
  const sheet = await costSheetForOrder(req.scope, order, ctx.rules, ctx.sellerByCode, metadata);
  const stored = readStoredSheet(metadata);
  res.json({
    order_id: order.id,
    display_id: order.display_id,
    currency_code: order.currency_code,
    // The sheet is the single source: `computeCostSheet` already carries the
    // target (over the net base) and the cost-based suggested price.
    ...sheet,
    updated_at: stored?.updated_at ?? null,
    updated_by: stored?.updated_by ?? null,
    seller_code: order.seller_code,
    seller_source: order.seller_source,
  });
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  try {
    await respondWithSheet(req, res, id);
  } catch (error) {
    logger.error(`[costing] sheet ${id} failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "sheet_failed", message: "Could not compute the cost sheet." });
  }
}

interface PutBody {
  lines?: Array<{ key?: unknown; label?: unknown; amount?: unknown; qty?: unknown }>;
  reset?: boolean;
}

export async function PUT(req: AuthenticatedMedusaRequest<PutBody>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as PutBody;
  try {
    const order = await fetchBoardOrder(req.scope, id);
    if (!order) {
      res.status(404).json({ type: "not_found", reason: "not_found", message: `Order '${id}' not found.` });
      return;
    }
    if (body.reset === true) {
      await saveStoredSheet(req.scope, id, null);
    } else {
      if (!Array.isArray(body.lines)) {
        res.status(400).json({ type: "invalid_data", reason: "lines_required", message: "Send { lines: [...] } or { reset: true }." });
        return;
      }
      if (body.lines.length > MAX_MANUAL_LINES) {
        res.status(400).json({ type: "invalid_data", reason: "too_many_lines", message: `At most ${MAX_MANUAL_LINES} lines.` });
        return;
      }
      const lines: StoredCostSheet["lines"] = [];
      for (const l of body.lines) {
        const amount = Number(l?.amount ?? 0);
        const qty = Number(l?.qty ?? 1);
        if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(qty) || qty < 0) {
          res.status(400).json({ type: "invalid_data", reason: "bad_amount", message: "Line amounts and quantities must be non-negative numbers." });
          return;
        }
        lines.push({
          key: String(l?.key ?? "manual").trim().slice(0, 80) || "manual",
          label: String(l?.label ?? "").trim().slice(0, 120) || "Ajuste",
          amount: Math.round(amount * 100) / 100,
          qty: Math.round(qty * 100) / 100,
        });
      }
      await saveStoredSheet(req.scope, id, {
        lines,
        updated_at: new Date().toISOString(),
        updated_by: req.auth_context?.actor_id ?? null,
      });
    }
    console.info(JSON.stringify({ event: "costing.sheet_saved", order_id: id, reset: body.reset === true, admin_user_id: req.auth_context?.actor_id ?? null, timestamp: new Date().toISOString() }));
    await syncOrderToSheet(req.scope, id, "costo");
    await respondWithSheet(req, res, id);
  } catch (error) {
    logger.error(`[costing] sheet save ${id} failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the cost sheet." });
  }
}
