import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ORDER_STAGES } from "../../../lib/order-status";
import { MAX_BOARD_SCAN, boardAccessFor, fetchBoardOrders, isOrderStage, restrictBoardRows } from "../../../lib/order-board";
import { parseBoardDate } from "../../../lib/board-dates";
import { listEstablishments } from "../../../lib/establishments";
import { sellableStores } from "../../../lib/pos";
import { getStaffScope } from "../../../lib/staff-scope";

/**
 * GET /admin/order-board — every order, filtered the way a shop owner thinks.
 *
 * Medusa's own `GET /admin/orders` can filter by date, region and sales channel,
 * but not by the thing this store actually runs on: the *stage* (confirmed → in
 * lab → shipped → in transit → delivered). That stage is derived from three
 * separate sources, one of which is a manual note in metadata, so it exists
 * nowhere as a column. This route computes it and filters on it, which is the
 * whole reason it exists rather than the panel calling `/admin/orders` directly.
 *
 * Authentication is Medusa's: everything under `/admin` requires a logged-in
 * user, so the corporate panel signs in through `/auth/user/emailpass` and sends
 * the resulting JWT. No parallel credential of our own.
 *
 * Who reads what (boardAccessFor, lib/order-board.ts): owner and superadmin,
 * everything. A supervisor or manager — the roles whose «Pedidos» tab joins
 * this board to their sales list — only the slim `stages` view, only the
 * stores they are assigned to, and with `total` redacted to null: the stage
 * strip shows them how many sales sit in each stage, never what they add up
 * to (owner's rule). A seller is refused with `forbidden_role`.
 *
 * Query params:
 *   q                 free text (id, customer, city, email, phone, items)
 *   from / to         ISO dates, inclusive — pushed down to the database
 *   stage             one of ORDER_STAGES
 *   terminal          canceled | refunded | payment_pending
 *   has_prescription  "true" | "false"
 *   seller            referral code (exact) | "none" (unattributed)
 *   store             establishment id (till sales of that store) | "web" (online store)
 *   limit / offset    page window (default 20, max 100)
 *   view              "stages" = slim rows (id, stage, next_stages, history,
 *                     totals — no items/addresses), max 300 per page, so the
 *                     executive list gets the stage of every sale of a period
 *                     in one request and merges it by `order_id`.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = req.query as Record<string, string | undefined>;

  // Refusals carry a `reason` code rather than a sentence: the panel is
  // bilingual and picks its own wording from `adm.err.*`. See the longer note in
  // the sibling stage route.
  const stage = query.stage;
  if (stage && !isOrderStage(stage)) {
    res.status(400).json({
      type: "invalid_data",
      reason: "unknown_stage",
      message: `Unknown stage '${stage}'. Allowed: ${ORDER_STAGES.join(", ")}.`,
    });
    return;
  }

  const terminal = query.terminal;
  if (terminal && !["canceled", "refunded", "payment_pending"].includes(terminal)) {
    res.status(400).json({
      type: "invalid_data",
      reason: "unknown_terminal",
      message: `Unknown terminal state '${terminal}'.`,
    });
    return;
  }

  // A bad date must not silently widen the range to "everything" — the owner
  // would be told they are looking at March while reading the whole history.
  const from = parseDate(query.from, "start");
  const to = parseDate(query.to, "end");
  if (from === false || to === false) {
    res.status(400).json({
      type: "invalid_data",
      reason: "bad_date",
      message: "Dates must be ISO (YYYY-MM-DD).",
    });
    return;
  }

  // Resolved here and not in the guard: the guard only knows the path, and
  // what changes by role is the SHAPE of the answer, not whether there is one.
  const actorId = req.auth_context?.actor_id;
  if (!actorId) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "No user behind this request." });
    return;
  }
  let access: ReturnType<typeof boardAccessFor>;
  try {
    const scope = await getStaffScope(req.scope, actorId);
    const storeIds = scope.is_admin ? null : sellableStores(scope, await listEstablishments(req.scope)).map((s) => s.id);
    access = boardAccessFor(scope, storeIds);
  } catch (error) {
    logger.error(`[order-board] could not resolve the caller's scope: ${(error as Error).message}`);
    res.status(503).json({ type: "unexpected_state", reason: "scope_unavailable", message: "Could not resolve the user's role." });
    return;
  }
  if (!access.allowed) {
    res.status(403).json({ type: "not_allowed", reason: access.reason, message: "This role cannot read the order board." });
    return;
  }

  try {
    const result = await fetchBoardOrders(req.scope, {
      q: query.q,
      from: from ?? undefined,
      to: to ?? undefined,
      stage: stage && isOrderStage(stage) ? stage : undefined,
      terminal: terminal as "canceled" | "refunded" | "payment_pending" | undefined,
      has_prescription:
        query.has_prescription === "true"
          ? true
          : query.has_prescription === "false"
            ? false
            : undefined,
      seller: query.seller || undefined,
      store: query.store || undefined,
      stores: access.stores ?? undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
      view: query.view === "stages" || access.slim_only ? "stages" : "full",
    });

    res.status(200).json({
      ...result,
      orders: access.money ? result.orders : restrictBoardRows(result.orders),
      stages: ORDER_STAGES,
      // So the panel can say "showing the most recent 300" instead of implying
      // the filtered count is the whole truth.
      scan_limit: MAX_BOARD_SCAN,
    });
  } catch (error) {
    logger.error(`[order-board] could not list orders: ${(error as Error).message}`);
    res.status(500).json({
      type: "error",
      reason: "list_failed",
      message: "Could not list orders.",
    });
  }
}

// `parseDate` moved to lib/board-dates.ts (shared with sellers/stats and
// costing/summary so every date range is read the same way).
const parseDate = parseBoardDate;
