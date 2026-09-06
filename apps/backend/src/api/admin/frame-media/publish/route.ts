import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { setPublished } from "../../../../lib/frame-media-writes";
import type { PublishFrameMediaSchema } from "../middlewares";

/**
 * POST /admin/frame-media/publish — mark reviewed assets as fit for the storefront.
 *
 * GENERATING AND PUBLISHING ARE TWO DIFFERENT ACTS, which is why `published` is a
 * column of its own and defaults to false. The views are INVENTED, not observed —
 * `gemini_media.py` says so in capitals — so a generated rear view of a frame the
 * shop actually sells can differ from the physical product. Whether that reaches a
 * customer is the owner's call after looking at it, never the pipeline's.
 *
 * Only `done` assets can be published: there is no file behind a pending or failed
 * one, and a `stale` one is knowingly out of date with its source photo.
 *
 * NOTE (phase 4 pending): flipping this flag does not yet change anything a
 * customer sees. The step that copies `output_key` into the variant metadata the
 * storefront reads is not built, so today this records the review decision and
 * nothing more. Said plainly here because "published" is a word an operator will
 * reasonably read as "live".
 */
export async function POST(
  req: AuthenticatedMedusaRequest<PublishFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;

  if (!body.ids?.length && !body.handles?.length) {
    res.status(400).json({
      reason: "no_selection",
      message: "Pass ids or handles — publishing everything is never implicit.",
    });
    return;
  }

  const { changed, eligible } = await setPublished(req.scope, {
    ids: body.ids,
    handles: body.handles,
    kind: body.kind,
    published: body.published,
  });

  // Audit: this is the decision that puts a model's invention in front of a
  // customer, so it carries a name and a timestamp like every spend does.
  console.info(
    JSON.stringify({
      event: body.published ? "frame_media.published" : "frame_media.unpublished",
      count: changed,
      kind: body.kind ?? "any",
      handles: body.handles?.length ?? 0,
      admin_user_id: req.auth_context.actor_id,
      timestamp: new Date().toISOString(),
    })
  );

  res.json({
    published: body.published,
    changed,
    /** Matched but already in the requested state — asking twice is a no-op. */
    unchanged: eligible - changed,
    /** Nothing outside `done` is eligible; a caller passing ids gets told. */
    eligible,
  });
}
