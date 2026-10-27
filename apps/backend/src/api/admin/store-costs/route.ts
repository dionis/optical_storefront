import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../lib/audit";
import { listEstablishments } from "../../../lib/establishments";
import { PosError } from "../../../lib/pos-data";
import { posHandler } from "../../../lib/pos-route";
import { presignPrescriptionUrl } from "../../../lib/s3";
import { cleanCostItem } from "../../../lib/store-costs";
import { costScope } from "../../../lib/store-costs-route";
import { uploadCostReceipt } from "../../../lib/tryon-image";
import { STORE_COST_MODULE } from "../../../modules/store-cost";
import type StoreCostModuleService from "../../../modules/store-cost/service";

/**
 * COSTOS POR TIENDA (HU-91, HU-92, HU-95).
 *
 *   GET  /admin/store-costs?store= — costos fijos y variables (y los compartidos, para admins).
 *   POST /admin/store-costs — alta { establishment_id | null, kind, category,
 *        description?, amount, frequency, amortize_months?, starts_on, ends_on?,
 *        vendor?, allocation? (compartidos), notes?, attachment? (data URL) }.
 *
 * Con el privilegio «Gestionar costos» (o «Ver costos» para leer). Cada cambio
 * queda en la auditoría con el antes y el después (HU-97).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { storeIds } = await costScope(req);
    const q = req.query as Record<string, string | undefined>;
    const rows = await req.scope.resolve<StoreCostModuleService>(STORE_COST_MODULE).listCostItems({}, { take: 5000, order: { starts_on: "DESC" } });
    const visible = rows.filter((r) => (storeIds === null ? true : r.establishment_id !== null && storeIds.includes(r.establishment_id)) && (!q.store || r.establishment_id === q.store || (q.store === "shared" && r.establishment_id === null)));
    const items = await Promise.all(
      visible.map(async (r) => ({
        ...r,
        amount: Number(r.amount_cents) / 100,
        attachment_url: r.attachment_key ? await presignPrescriptionUrl(r.attachment_key) : null,
      }))
    );
    res.json({ items });
  });
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { scope, storeIds } = await costScope(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const known = (await listEstablishments(req.scope)).map((s) => s.id);
    const cleaned = cleanCostItem(body, storeIds ?? known);
    if ("reason" in cleaned) throw new PosError(cleaned.reason);
    if (cleaned.item.establishment_id === null && storeIds !== null) throw new PosError("forbidden_role", 403);
    const attachment_key = await uploadCostReceipt(body.attachment);
    const created = await req.scope.resolve<StoreCostModuleService>(STORE_COST_MODULE).createCostItems({
      ...cleaned.item,
      allocation: cleaned.item.allocation as unknown as Record<string, unknown>,
      attachment_key,
      created_by: scope.user_id,
      updated_by: scope.user_id,
    } as never);
    await recordAudit(req.scope, { actorId: scope.user_id, action: "cost.change", entity: "cost_item", entityId: (created as { id: string }).id, establishmentId: cleaned.item.establishment_id, after: cleaned.item });
    res.json({ item: created });
  });
}
