import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { upsertBudget } from "../../../../lib/frame-media-writes";
import {
  FRAME_MEDIA_BUDGET_ID,
  resolveFrameMediaSettings,
  resolveSpend,
  TIERS,
} from "../../../../lib/frame-media-settings";
import type { UpdateFrameMediaBudgetSchema } from "../middlewares";

async function payload(scope: AuthenticatedMedusaRequest["scope"]) {
  const [settings, spend] = await Promise.all([
    resolveFrameMediaSettings(scope),
    resolveSpend(scope),
  ]);
  return { settings, spend, tiers: TIERS };
}

/** GET /admin/frame-media/budget — current ceilings, ladder and spend to date. */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  res.json(await payload(req.scope));
}

/**
 * POST /admin/frame-media/budget — edit the knobs an operator may turn.
 *
 * The monthly ceilings are NOT among them: they come from the tier, so raising
 * what may be spent in a month means climbing the ladder (and meeting its
 * condition), not typing a bigger number. Nor is the model — that is a cost
 * decision and stays server-side, the same rule as OCR.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<UpdateFrameMediaBudgetSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;
  await upsertBudget(req.scope, FRAME_MEDIA_BUDGET_ID, {
    ...body,
    updated_by: req.auth_context.actor_id,
  });

  console.info(
    JSON.stringify({
      event: "frame_media.budget_updated",
      changes: body,
      admin_user_id: req.auth_context.actor_id,
      timestamp: new Date().toISOString(),
    })
  );

  res.json(await payload(req.scope));
}
