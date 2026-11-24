import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { invalidatePriceCaches, loadMatrixStores } from "../../../../../lib/price-matrix-data";
import { matrixAccess } from "../../../../../lib/price-matrix-route";
import { storeLensToggleDenied, type StoreLensToggleKind } from "../../../../../lib/store-lens-toggle";
import { setStoreLensToggle } from "../../../../../lib/store-lens-toggle-data";

/**
 * POST /admin/pricing/matrix/toggle
 *   { store: string, kind: "design"|"lens"|"photo"|"ar"|"treatment_group", key: string, enabled: boolean }
 *
 * Enables or disables a lens design, lens cell, treatment family, photochromic,
 * or anti-reflective option in ONE store (physical or online). Costs never
 * change; global switches remain intact above per-store rules.
 *
 * Owner and superadmin only (`forbidden_role`).
 * Reasons: `forbidden_role` (403), `store_not_found` (404),
 * `store_required` / `bad_kind` / `bad_key` / `bad_value` (422), `save_failed` (500).
 */
interface Body {
  store?: unknown;
  kind?: unknown;
  key?: unknown;
  enabled?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can enable or disable store options." });
    return;
  }
  const body = (req.body ?? {}) as Body;
  const reason = storeLensToggleDenied(body);
  if (reason) {
    res.status(422).json({ type: "invalid_data", reason, message: "Invalid toggle payload." });
    return;
  }
  const storeId = String(body.store).trim();
  const kind = String(body.kind) as StoreLensToggleKind;
  const key = String(body.key).trim();
  const enabled = Boolean(body.enabled);

  try {
    const stores = await loadMatrixStores(req.scope);
    if (!stores.some((s) => s.id === storeId)) {
      res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
      return;
    }
    const out = await setStoreLensToggle(req.scope, { establishmentId: storeId, kind, key, enabled }, access.actorId);
    invalidatePriceCaches();
    logger.info(`[price-matrix] toggle ${kind}:${key} @ ${storeId} -> ${enabled} by ${access.actorId ?? "?"}`);
    res.json({ ok: true, store: storeId, kind, key, enabled: out.after });
  } catch (error) {
    logger.error(`[price-matrix] toggle failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the toggle." });
  }
}
