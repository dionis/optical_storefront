import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../lib/gsheet-sync";
import { cleanTreatment, redactMatrixCosts } from "../../../../lib/price-matrix";
import { createTreatment, loadMatrixSection } from "../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../lib/price-matrix-route";

/**
 * POST /admin/pricing/treatments
 *   { type: "photo"|"ar", label_es, label_en, code?, cost?, ar_group?: "all"|"sv"|"bifprog",
 *     prices: { sv, bifocal, prog } (photo, dollars, null = not offered) | 25 (ar, dollars) }
 *
 * A new photochromic (`lens_photo_option`) or anti-reflective
 * (`lens_ar_option`), active, at the end of the list, with a `code` derived
 * from the label (lib/price-matrix.ts `deriveTreatmentCode`) unless one is
 * given. Its store prices and discounts are then cells of the Tratamientos
 * section like any other.
 *
 * Answers 201 `{ type, code, rows }` — `rows` = the new option's rows in the
 * matrix GET's shape (one per category for a photochromic). Owner and
 * superadmin only; a cost also needs «Gestionar costos». Reasons: `bad_type`,
 * `bad_label`, `bad_value`, `code_taken`, `forbidden_role`, `save_failed`.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const access = await matrixAccess(req);
  const wantsCost = body["cost"] != null && body["cost"] !== "";
  if (!access.isAdmin || (wantsCost && !access.canManageCosts)) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can add treatments." });
    return;
  }
  const cleaned = cleanTreatment(body);
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid treatment." });
    return;
  }
  try {
    const created = await createTreatment(req.scope, cleaned.treatment, access.actorId);
    if ("reason" in created) {
      res.status(409).json({ type: "conflict", reason: created.reason, message: "That code is already used." });
      return;
    }
    const { groups } = await loadMatrixSection(req.scope, "treatments", { withCosts: access.canSeeCosts });
    const rows = redactMatrixCosts(groups, access.canSeeCosts)
      .flatMap((g) => g.rows)
      .filter((r) => r.code === created.code && r.kind === cleaned.treatment.type);
    logger.info(`[pricing] treatment ${cleaned.treatment.type} ${created.code} created by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.status(201).json({ type: cleaned.treatment.type, code: created.code, rows });
  } catch (error) {
    logger.error(`[pricing] treatment create failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not create the treatment." });
  }
}
