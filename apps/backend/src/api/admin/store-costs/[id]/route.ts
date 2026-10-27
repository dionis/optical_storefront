import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../lib/audit";
import { listEstablishments } from "../../../../lib/establishments";
import { PosError } from "../../../../lib/pos-data";
import { posHandler } from "../../../../lib/pos-route";
import { cleanCostItem } from "../../../../lib/store-costs";
import { costScope } from "../../../../lib/store-costs-route";
import { uploadCostReceipt } from "../../../../lib/tryon-image";
import { STORE_COST_MODULE } from "../../../../modules/store-cost";
import type StoreCostModuleService from "../../../../modules/store-cost/service";

/**
 * POST   /admin/store-costs/:id — edita un costo (el registro completo).
 * DELETE /admin/store-costs/:id — lo borra (borrado lógico: queda en la auditoría).
 * Privilegio «Gestionar costos»; cada cambio guarda antes y después (HU-97).
 */
async function load(req: AuthenticatedMedusaRequest, storeIds: string[] | null) {
  const svc = req.scope.resolve<StoreCostModuleService>(STORE_COST_MODULE);
  const [row] = await svc.listCostItems({ id: String(req.params.id ?? "") }, { take: 1 });
  if (!row) throw new PosError("cost_not_found", 404);
  if (storeIds !== null && (row.establishment_id === null || !storeIds.includes(row.establishment_id))) throw new PosError("forbidden_store", 403);
  return { svc, row };
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { scope, storeIds } = await costScope(req);
    const { svc, row } = await load(req, storeIds);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const known = (await listEstablishments(req.scope)).map((s) => s.id);
    const cleaned = cleanCostItem(body, storeIds ?? known);
    if ("reason" in cleaned) throw new PosError(cleaned.reason);
    if (cleaned.item.establishment_id === null && storeIds !== null) throw new PosError("forbidden_role", 403);
    const attachment_key = body.attachment ? await uploadCostReceipt(body.attachment) : row.attachment_key;
    await svc.updateCostItems({ id: row.id, ...cleaned.item, allocation: cleaned.item.allocation as unknown as Record<string, unknown>, attachment_key, updated_by: scope.user_id } as never);
    await recordAudit(req.scope, { actorId: scope.user_id, action: "cost.change", entity: "cost_item", entityId: row.id, establishmentId: cleaned.item.establishment_id, before: { ...row, attachment_key: undefined }, after: cleaned.item });
    res.json({ ok: true });
  });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { scope, storeIds } = await costScope(req);
    const { svc, row } = await load(req, storeIds);
    await svc.softDeleteCostItems([row.id]);
    await recordAudit(req.scope, { actorId: scope.user_id, action: "cost.change", entity: "cost_item", entityId: row.id, establishmentId: row.establishment_id, before: { ...row, attachment_key: undefined }, after: null });
    res.json({ ok: true });
  });
}
