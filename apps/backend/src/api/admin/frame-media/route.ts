import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { FRAME_MEDIA_MODULE } from "../../../modules/frame-media/index";
import type FrameMediaModuleService from "../../../modules/frame-media/service";
import { PILOT_HANDLES } from "../../../lib/frame-media-pilot";

/** Hard cap on one page of the board. The panel paginates; it never scans blind. */
const MAX_LIMIT = 200;

/**
 * GET /admin/frame-media — the board.
 *
 * Unlike the order board, status here IS a column, so every filter runs in the
 * database and the response is never a partial scan. That is the whole reason
 * this table stores `status` rather than deriving it from three sources.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const q = req.query;
  const limit = Math.min(Number(q.limit ?? 50) || 50, MAX_LIMIT);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

  const filters: Record<string, unknown> = {};
  if (q.kind) filters.kind = String(q.kind);
  if (q.status) filters.status = String(q.status).split(",");
  if (q.handle) filters.product_handle = String(q.handle).split(",");
  if (q.scope === "pilot") filters.product_handle = PILOT_HANDLES;
  if (q.published !== undefined) filters.published = q.published === "true";

  const svc = req.scope.resolve<FrameMediaModuleService>(FRAME_MEDIA_MODULE);

  const [rows, count] = (await svc.listAndCountFrameMediaAssets(filters, {
    take: limit,
    skip: offset,
    order: { product_handle: "ASC", kind: "ASC", slot: "ASC" },
  })) as unknown as [Record<string, unknown>[], number];

  res.json({
    assets: rows,
    count,
    limit,
    offset,
    /** True when there are more pages. The panel must show this, not scroll blind. */
    has_more: offset + rows.length < count,
  });
}
