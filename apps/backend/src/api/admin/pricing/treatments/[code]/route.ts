import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { cleanTreatmentPatch, redactMatrixCosts } from "../../../../../lib/price-matrix";
import { loadMatrixSection } from "../../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../../lib/price-matrix-route";
import { deleteTreatment, findTreatment, updateTreatment, type TreatmentType } from "../../../../../lib/treatment-data";

const typeOf = (v: unknown): TreatmentType | null => (v === "photo" || v === "ar" ? v : null);

/**
 * POST /admin/pricing/treatments/:code (v2, docs/PRICE-MATRIX.md «Tratamientos»)
 *   { type?: "photo"|"ar", label_es?, label_en?, ar_group?, cost?, is_active?,
 *     prices?: { sv?, bifocal?, prog? } (photo, dollars; null = no longer offered) | 25 (ar) }
 *
 * Edits a photochromic or an AR option, only the keys sent. `type` is only
 * needed when the same code exists in both lists. The stores' own prices and
 * discounts stay cells of the matrix. Answers `{ type, code, rows }` (the
 * option's rows in the GET's shape). Owner and superadmin only; a cost also
 * needs «Gestionar costos». Reasons: `forbidden_role` (403),
 * `treatment_not_found` (404), `bad_type` / `bad_label` / `bad_value` /
 * `nothing_to_change` (422), `save_failed` (500). Audited as `catalog.update`.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const access = await matrixAccess(req);
  const wantsCost = "cost" in body;
  if (!access.isAdmin || (wantsCost && !access.canManageCosts)) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can edit treatments." });
    return;
  }
  const code = String(req.params?.code ?? "").trim();
  if (body["type"] != null && !typeOf(body["type"])) {
    res.status(422).json({ type: "invalid_data", reason: "bad_type", message: "Unknown treatment type." });
    return;
  }
  try {
    const found = await findTreatment(req.scope, code, typeOf(body["type"]));
    if (!found) {
      res.status(404).json({ type: "not_found", reason: "treatment_not_found", message: `No treatment ${code}.` });
      return;
    }
    if ("reason" in found) {
      res.status(422).json({ type: "invalid_data", reason: found.reason, message: "Say which list the code belongs to (type)." });
      return;
    }
    const cleaned = cleanTreatmentPatch(found.type, body);
    if ("reason" in cleaned) {
      res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid treatment change." });
      return;
    }
    const out = await updateTreatment(req.scope, { code, type: found.type, patch: cleaned.patch }, access.actorId);
    if ("reason" in out) {
      res.status(out.reason === "treatment_not_found" ? 404 : 422).json({ type: "invalid_data", reason: out.reason, message: "The treatment cannot take this change." });
      return;
    }
    const { groups } = await loadMatrixSection(req.scope, "treatments", { withCosts: access.canSeeCosts });
    const rows = redactMatrixCosts(groups, access.canSeeCosts)
      .flatMap((g) => g.rows)
      .filter((r) => r.code === code && r.kind === out.type);
    logger.info(`[pricing] treatment ${out.type} ${code} edited by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json({ type: out.type, code, rows });
  } catch (error) {
    logger.error(`[pricing] treatment edit failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the treatment." });
  }
}

/**
 * DELETE /admin/pricing/treatments/:code[?type=photo|ar]
 *   → { deleted: true, type } | { archived: true, type }
 *
 * Never sold (no till fact and no order line carries the code) → the option
 * is deleted, with the stores' own prices and discounts of it. Sold → it is
 * switched off (`is_active: false`): the till and the web stop offering it,
 * its receipts keep their labels. Owner and superadmin only. Reasons:
 * `forbidden_role` (403), `treatment_not_found` (404), `bad_type` (422),
 * `save_failed` (500). Audited as `catalog.delete`.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can remove treatments." });
    return;
  }
  const code = String(req.params?.code ?? "").trim();
  const rawType = (req.query as Record<string, unknown> | undefined)?.["type"];
  if (rawType != null && rawType !== "" && !typeOf(rawType)) {
    res.status(422).json({ type: "invalid_data", reason: "bad_type", message: "Unknown treatment type." });
    return;
  }
  try {
    const out = await deleteTreatment(req.scope, { code, type: typeOf(rawType) }, access.actorId);
    if ("reason" in out) {
      res.status(out.reason === "treatment_not_found" ? 404 : 422).json({ type: "invalid_data", reason: out.reason, message: `Treatment ${code} cannot be removed.` });
      return;
    }
    logger.info(`[pricing] treatment ${out.type} ${code} ${"deleted" in out ? "deleted" : "switched off"} by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json(out);
  } catch (error) {
    logger.error(`[pricing] treatment delete failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not remove the treatment." });
  }
}
