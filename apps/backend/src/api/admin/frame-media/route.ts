import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { listAssets } from "../../../lib/frame-media-claim";
import { PILOT_HANDLES } from "../../../lib/frame-media-pilot";

/** Hard cap on one page of the board. The panel paginates; it never scans blind. */
const MAX_LIMIT = 200;

/**
 * GET /admin/frame-media — the board.
 *
 * Unlike the order board, status here IS a column, so every filter runs in the
 * database and the response is never a partial scan. That is the whole reason
 * this table stores `status` rather than deriving it from three sources.
 *
 * Reads through `listAssets` (raw SQL) rather than the module service: the
 * generated `listAndCount` returned a 500 for every argument shape tried,
 * including no filters at all. See the note on that function.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const q = req.query;
  const limit = Math.min(Number(q.limit ?? 50) || 50, MAX_LIMIT);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

  const handles =
    q.scope === "pilot"
      ? PILOT_HANDLES
      : q.handle
        ? String(q.handle).split(",")
        : undefined;

  const { assets, count } = await listAssets(req.scope, {
    kind: q.kind ? String(q.kind) : undefined,
    statuses: q.status ? String(q.status).split(",") : undefined,
    handles,
    published: q.published === undefined ? undefined : q.published === "true",
    limit,
    offset,
  });

  res.json({
    assets,
    count,
    limit,
    offset,
    /** True when there are more pages. The panel must show this, not scroll blind. */
    has_more: offset + assets.length < count,
  });
}
