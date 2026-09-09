import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { syncVariantMedia } from "../../../../lib/frame-media-sync";
import type { SyncFrameMediaSchema } from "../middlewares";

/**
 * POST /admin/frame-media/sync — publish the generated files onto the products.
 *
 * This is the step that makes a generated view reachable at all: the storefront
 * reads the Store API, and the Store API only carries what is on the product, so
 * an asset that is not copied into `variant.metadata` is a file nobody can see.
 *
 * Writing the product also fires `product.updated`, which the existing
 * `product-meilisearch` subscriber already listens to — so the search index
 * refreshes on its own. That is deliberate: it means there is no second thing to
 * remember to run.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<SyncFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const { handles } = req.validatedBody;

  const result = await syncVariantMedia(req.scope, handles);

  console.info(
    JSON.stringify({
      event: "frame_media.synced",
      ...result,
      admin_user_id: req.auth_context.actor_id,
      timestamp: new Date().toISOString(),
    })
  );

  res.json(result);
}
