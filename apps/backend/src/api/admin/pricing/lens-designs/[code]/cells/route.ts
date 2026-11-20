import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { mirrorPricesToSheet } from "../../../../../../lib/gsheet-sync";
import { cleanLensCell } from "../../../../../../lib/lens-design";
import { addLensCell, deleteLensCell } from "../../../../../../lib/lens-design-data";
import { parseLensFinish } from "../../../../../../lib/lens-finish";
import { matrixAccess } from "../../../../../../lib/price-matrix-route";

const codeOf = (req: AuthenticatedMedusaRequest): string => String(req.params?.code ?? "").trim();

async function categoryOf(req: AuthenticatedMedusaRequest, code: string): Promise<string | null> {
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const row = (await pg("lens_design").whereNull("deleted_at").where({ code }).first("category")) as { category?: string } | undefined;
  return row ? String(row.category ?? "") : null;
}

/**
 * POST /admin/pricing/lens-designs/:code/cells
 *   { material_code | new_material: { label_es, label_en, max_abs? }, finish?: "stock"|"digital", price, cost? }
 * A material offered in the design, with its price (and lab cost) — a new row
 * of the design in the matrix; its store prices and discounts are then cells
 * like any other. A progressive is always digital. Owner and superadmin; a
 * cost also needs «Gestionar costos». Answers 201 `{ key, material_code }`.
 * Reasons: `forbidden_role` (403), `design_not_found` (404), `bad_material` /
 * `bad_label` / `bad_value` / `finish_unavailable` (422), `cell_exists` (409).
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const access = await matrixAccess(req);
  const wantsCost = body["cost"] != null && body["cost"] !== "";
  if (!access.isAdmin || (wantsCost && !access.canManageCosts)) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can add lens materials." });
    return;
  }
  try {
    const code = codeOf(req);
    const category = await categoryOf(req, code);
    if (category === null) {
      res.status(404).json({ type: "not_found", reason: "design_not_found", message: "No such lens design." });
      return;
    }
    const cleaned = cleanLensCell(body, category);
    if ("reason" in cleaned) {
      res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid lens cell." });
      return;
    }
    const out = await addLensCell(req.scope, code, cleaned.cell, access.actorId);
    if ("reason" in out) {
      const status = out.reason === "cell_exists" ? 409 : out.reason === "design_not_found" ? 404 : 422;
      res.status(status).json({ type: "invalid_data", reason: out.reason, message: "The cell cannot be added." });
      return;
    }
    void mirrorPricesToSheet(req.scope);
    res.status(201).json(out);
  } catch (error) {
    logger.error(`[pricing] lens cell add failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not add the lens cell." });
  }
}

/**
 * DELETE /admin/pricing/lens-designs/:code/cells?material=&finish= → { deleted: true }
 * The material stops being offered in the design (soft delete). Owner and
 * superadmin only. Reasons: `forbidden_role` (403), `design_not_found` /
 * `cell_not_found` (404), `bad_value` (422).
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can remove lens materials." });
    return;
  }
  const q = req.query as Record<string, unknown>;
  const material = typeof q.material === "string" ? q.material.trim() : "";
  const finish = parseLensFinish(q.finish ?? "stock");
  if (!material || !finish) {
    res.status(422).json({ type: "invalid_data", reason: "bad_value", message: "Say which material and finish." });
    return;
  }
  try {
    const out = await deleteLensCell(req.scope, codeOf(req), material, finish, access.actorId);
    if ("reason" in out) {
      res.status(404).json({ type: "not_found", reason: out.reason, message: "No such lens cell." });
      return;
    }
    void mirrorPricesToSheet(req.scope);
    res.json(out);
  } catch (error) {
    logger.error(`[pricing] lens cell delete failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not remove the lens cell." });
  }
}
