import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../lib/gsheet-sync";
import { cleanLensDesign } from "../../../../lib/lens-design";
import { createLensDesign } from "../../../../lib/lens-design-data";
import { matrixAccess } from "../../../../lib/price-matrix-route";

/**
 * POST /admin/pricing/lens-designs
 *   { label_es, label_en, category: "sv"|"bifocal"|"prog", code?, requires_add?, tier?, use_es?, use_en? }
 *
 * A new lens design (a group of «Productos y precios» → Lentes), active, at
 * the end of the list, without cells yet: its materials are added next
 * (`…/:code/cells`). Owner and superadmin only. Answers 201 `{ code }`.
 * Reasons: `bad_label`, `bad_category`, `bad_value` (422), `code_taken` (409),
 * `forbidden_role` (403), `save_failed` (500). docs/PRICE-MATRIX.md §12.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can add lens designs." });
    return;
  }
  const cleaned = cleanLensDesign((req.body ?? {}) as Record<string, unknown>);
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid lens design." });
    return;
  }
  try {
    const out = await createLensDesign(req.scope, cleaned.design, access.actorId);
    if ("reason" in out) {
      res.status(409).json({ type: "conflict", reason: out.reason, message: "That code is already used." });
      return;
    }
    logger.info(`[pricing] lens design ${out.code} created by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.status(201).json(out);
  } catch (error) {
    logger.error(`[pricing] lens design create failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not create the lens design." });
  }
}
