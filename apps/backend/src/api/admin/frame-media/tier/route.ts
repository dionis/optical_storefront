import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { upsertBudget } from "../../../../lib/frame-media-writes";
import {
  FRAME_MEDIA_BUDGET_ID,
  resolveFrameMediaSettings,
  tierFor,
} from "../../../../lib/frame-media-settings";
import { evaluateTier } from "../../../../lib/frame-media-tier";
import type { UpdateFrameMediaTierSchema } from "../middlewares";

/** GET /admin/frame-media/tier — current level plus every check for the next one. */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const settings = await resolveFrameMediaSettings(req.scope);
  const eligibility = await evaluateTier(req.scope, settings.tier);
  res.json({ tier: tierFor(settings.tier), eligibility });
}

/**
 * POST /admin/frame-media/tier — climb (or drop) the ladder.
 *
 * The most expensive click in the panel: level 3 removes the frame cap. So going
 * UP is refused unless the level's measured conditions hold, and only one step at
 * a time — skipping from 0 to 3 would bypass every gate that exists to catch a
 * bad pipeline cheaply.
 *
 * Going DOWN is always allowed and needs no justification: tightening a budget
 * should never require passing a test.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<UpdateFrameMediaTierSchema>,
  res: MedusaResponse
): Promise<void> {
  const target = req.validatedBody.tier;
  const settings = await resolveFrameMediaSettings(req.scope);

  if (target > settings.tier) {
    if (target !== settings.tier + 1) {
      res.status(409).json({
        reason: "tier_skip",
        message: `Cannot jump from tier ${settings.tier} to ${target}.`,
        current: settings.tier,
      });
      return;
    }

    const eligibility = await evaluateTier(req.scope, settings.tier);
    if (!eligibility.eligible) {
      res.status(409).json({
        reason: "tier_condition_unmet",
        message: "The conditions for the next tier are not met yet.",
        eligibility,
      });
      return;
    }
  }

  await upsertBudget(req.scope, FRAME_MEDIA_BUDGET_ID, {
    tier: target,
    updated_by: req.auth_context.actor_id,
  });

  console.info(
    JSON.stringify({
      event: "frame_media.tier_changed",
      from: settings.tier,
      to: target,
      admin_user_id: req.auth_context.actor_id,
      timestamp: new Date().toISOString(),
    })
  );

  const updated = await resolveFrameMediaSettings(req.scope);
  res.json({
    tier: tierFor(updated.tier),
    eligibility: await evaluateTier(req.scope, updated.tier),
  });
}
