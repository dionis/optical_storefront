import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { FRAME_MEDIA_MODULE } from "../../../../modules/frame-media/index";
import type FrameMediaModuleService from "../../../../modules/frame-media/service";
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
  const svc = req.scope.resolve<FrameMediaModuleService>(FRAME_MEDIA_MODULE);

  const existing = (await svc.listFrameMediaBudgets({
    id: FRAME_MEDIA_BUDGET_ID,
  })) as unknown as Record<string, unknown>[];

  // `model.json()` is typed as an object, but JSONB stores an array perfectly
  // well and a bare list of handles is the honest shape here — wrapping it in
  // `{ handles: [...] }` would only exist to satisfy the type. The cast is kept
  // to this one line, and `resolveFrameMediaSettings` guards the read with
  // `Array.isArray` so a hand-edited row cannot crash the resolver.
  const { video_sku_list, ...rest } = body;
  const data: Record<string, unknown> = {
    ...rest,
    ...(video_sku_list !== undefined ? { video_sku_list } : {}),
    updated_by: req.auth_context.actor_id,
  };

  if (existing?.length) {
    await svc.updateFrameMediaBudgets({ id: FRAME_MEDIA_BUDGET_ID, ...data });
  } else {
    await svc.createFrameMediaBudgets({ id: FRAME_MEDIA_BUDGET_ID, ...data });
  }

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
