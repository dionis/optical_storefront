import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import type { IProductModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { randomUUID } from "node:crypto";
import { enqueueAssets } from "../../../../lib/frame-media-claim";
import { slotsFor, MediaKind, ViewSlot } from "../../../../lib/frame-media";
import { estimateBatch } from "../../../../lib/frame-media-cost";
import { resolveFrameMediaSettings } from "../../../../lib/frame-media-settings";
import type { EnqueueFrameMediaSchema } from "../middlewares";

/**
 * Collections this pipeline must never enqueue, by `metadata.collection_slug`.
 * Overridable so the owner can add one without a code change; the default is the
 * catalogue's 28 cases, which are the ones that actually broke a run.
 */
const EXCLUDED_COLLECTIONS = new Set(
  (process.env.FRAME_MEDIA_EXCLUDED_COLLECTIONS ?? "case")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

interface VariantLike {
  id: string;
  sku?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * POST /admin/frame-media/enqueue — declare that these frames should get media.
 *
 * DECLARING INTENT IS NOT SPENDING. This writes `pending` rows and reports what
 * they would cost; nothing here calls a provider. The money is decided at claim
 * time, on the server, against the ceiling — so an over-enthusiastic enqueue is
 * recoverable, and a client can never authorise a charge by asking nicely.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<EnqueueFrameMediaSchema>,
  res: MedusaResponse
): Promise<void> {
  const body = req.validatedBody;
  const kind = body.kind as MediaKind;

  const productService = req.scope.resolve<IProductModuleService>(Modules.PRODUCT);
  const products = await productService.listProducts(
    { handle: body.handles },
    { relations: ["variants"] }
  );

  const missing = body.handles.filter(
    (h) => !products.some((p) => p.handle === h)
  );

  const slots = (
    body.slots?.length ? body.slots : slotsFor(kind)
  ) as (ViewSlot | null)[];

  const rows: Parameters<typeof enqueueAssets>[1] = [];
  const skippedNoImage: string[] = [];
  const skippedNotAFrame: string[] = [];

  for (const product of products) {
    // The prompts describe eyewear. Handed a case, Gemini answers in prose and
    // the asset fails `no_image_returned` — free, but it is still CLAIMABLE
    // twice more (MAX_ATTEMPTS), so a handful of cases sitting early in the
    // alphabet trips the ten-failure breaker before any frame is reached. A
    // queue is not the place to discover a product was never a frame.
    const collection = (product.metadata?.collection_slug as string | undefined) ?? null;
    if (collection && EXCLUDED_COLLECTIONS.has(collection)) {
      skippedNotAFrame.push(product.handle!);
      continue;
    }

    const variants = (product.variants ?? []) as VariantLike[];
    for (const variant of variants) {
      const colorway =
        (variant.metadata?.color as string | undefined) ?? variant.title ?? null;

      if (body.colorways?.length && (!colorway || !body.colorways.includes(colorway))) {
        continue;
      }

      // The source photo is the ground truth the whole IDENTITY_GUARD rests on.
      // A variant without one cannot be generated from, and enqueueing it would
      // only produce a row that fails later having consumed a claim slot.
      const sourceImage = (variant.metadata?.image as string | undefined) ?? null;
      if (!sourceImage) {
        skippedNoImage.push(variant.sku ?? variant.id);
        continue;
      }

      const sku = variant.sku ?? variant.id;
      for (const slot of slots) {
        rows.push({
          id: `fma_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          product_handle: product.handle!,
          variant_sku: sku,
          colorway,
          kind,
          slot: slot ?? null,
          source_image_url: sourceImage,
          requested_by: req.auth_context.actor_id,
        });
      }
    }
  }

  const inserted = await enqueueAssets(req.scope, rows);

  const settings = await resolveFrameMediaSettings(req.scope);
  const estimate = estimateBatch({
    views: kind === "view" ? inserted : 0,
    videos: kind === "video" ? inserted : 0,
    imageModel: settings.image_model_id,
    videoModel: settings.video_model_id,
  });

  // Audit: an enqueue is an authorisation to spend later, so it carries a name.
  console.info(
    JSON.stringify({
      event: "frame_media.enqueued",
      kind,
      requested: rows.length,
      inserted,
      already_present: rows.length - inserted,
      estimated_usd: estimate.total_usd,
      handles: body.handles.length,
      admin_user_id: req.auth_context.actor_id,
      timestamp: new Date().toISOString(),
    })
  );

  res.json({
    kind,
    requested: rows.length,
    /** New rows. The difference is assets that already existed — asking twice is free. */
    inserted,
    already_present: rows.length - inserted,
    estimate,
    /** Handles Medusa does not know. Usually the storefront seed slug by mistake. */
    unknown_handles: missing,
    /** Variants with no source photo: nothing to generate from. */
    skipped_no_source_image: skippedNoImage,
    /** Products that are not eyewear (cases, accessories): nothing to render. */
    skipped_not_a_frame: skippedNotAFrame,
  });
}
