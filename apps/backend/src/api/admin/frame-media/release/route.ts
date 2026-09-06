import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { releaseRun } from "../../../../lib/frame-media-claim";
import type { ReleaseFrameMediaSchema } from "../middlewares";

/**
 * POST /admin/frame-media/release — hand back whatever a run still holds.
 *
 * Called by the CLI when it stops for any reason: finished, Ctrl-C, or a crash on
 * the way out. Without it, a run that dies leaves its whole batch sitting in
 * `running` until the 20-minute lease expires — with `attempts` still 0 and no
 * error recorded, so the board says "in progress" about work nobody is doing and
 * gives no hint why it stopped.
 *
 * The lease is still the backstop for the case this cannot cover: a hard kill, a
 * lost network, a laptop closing. This just makes the ordinary exit immediate
 * instead of a twenty-minute wait.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<ReleaseFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const { run_id } = req.validatedBody;
  const released = await releaseRun(req.scope, run_id);

  if (released) {
    console.info(
      JSON.stringify({
        event: "frame_media.released",
        run_id,
        released,
        admin_user_id: req.auth_context.actor_id,
        timestamp: new Date().toISOString(),
      })
    );
  }

  res.json({ run_id, released });
}
