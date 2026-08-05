import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ORDER_STAGES } from "../../../lib/order-status";
import { MAX_BOARD_SCAN, fetchBoardOrders, isOrderStage } from "../../../lib/order-board";

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
 * Query params:
 *   q                 free text (id, customer, city, email, phone, items)
 *   from / to         ISO dates, inclusive — pushed down to the database
 *   stage             one of ORDER_STAGES
 *   terminal          canceled | refunded | payment_pending
 *   has_prescription  "true" | "false"
 *   limit / offset    page window (default 20, max 100)
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
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });

    res.status(200).json({
      ...result,
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

/**
 * Accept a plain `YYYY-MM-DD` and widen it to cover the whole local day.
 *
 * The owner picks a day, not an instant. Passing the bare date through would
 * make `to=2026-03-10` mean "up to midnight", silently dropping every order
 * placed during that day — the single most confusing thing a date filter can do.
 *
 * Returns `false` for input that is present but unparseable, so the caller can
 * reject rather than quietly ignore it.
 */
function parseDate(value: string | undefined, edge: "start" | "end"): string | null | false {
  if (!value) return null;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const iso = bare ? `${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString();
}
