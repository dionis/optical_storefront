import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../lib/audit";
import { listCostRules, upsertCostRules } from "../../../../../lib/costing";
import { listEstablishments } from "../../../../../lib/establishments";
import { loadStoredItems } from "../../../../../lib/finance-rules";
import { mirrorCostRulesToSheet, mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { PosError } from "../../../../../lib/pos-data";
import { posHandler } from "../../../../../lib/pos-route";
import { listSellers, sellerService } from "../../../../../lib/sellers";
import { loadDefaultCommissionPct, saveDefaultCommissionPct } from "../../../../../lib/store-cost-toggle";
import { costScope } from "../../../../../lib/store-costs-route";
import { isPerSaleRule, planRulesImport, type ImportInput } from "../../../../../lib/store-costs-import";
import { STORE_COST_MODULE } from "../../../../../modules/store-cost";
import type StoreCostModuleService from "../../../../../modules/store-cost/service";

/**
 * POST /admin/finance/rules/import
 *   { apply?: boolean, costs?: [...], rules?: [...], commissions?: { default_pct?, sellers?: [...] } }
 *
 * The «Reglas y comisiones» workbook, read in the browser. `apply` false (the
 * default) answers the plan (lib/store-costs-import.ts): creations, field
 * changes before → after, unchanged count, errors. `apply` true writes the
 * SAME plan — refused with 422 `import_has_errors` while any row is wrong —
 * and audits every write. Nothing is ever deleted by an import.
 */
export async function POST(req: AuthenticatedMedusaRequest<ImportInput & { apply?: unknown }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const { scope, storeIds } = await costScope(req);
    const body = (req.body ?? {}) as ImportInput & { apply?: unknown };
    const [stores, items, rules, sellers, defaultPct] = await Promise.all([
      listEstablishments(req.scope),
      loadStoredItems(req.scope),
      listCostRules(req.scope),
      listSellers(req.scope).catch(() => []),
      loadDefaultCommissionPct(req.scope),
    ]);
    const plan = planRulesImport(
      { costs: Array.isArray(body.costs) ? body.costs : [], rules: Array.isArray(body.rules) ? body.rules : [], commissions: body.commissions ?? null },
      {
        items,
        rules: rules.filter(isPerSaleRule),
        sellers: sellers.map((s) => ({ id: s.id, code: s.code, name: s.name, commission_pct: Number(s.commission_pct) || 0 })),
        defaultPct,
        storeByCode: new Map(stores.map((s) => [s.code, s.id])),
        writableStores: storeIds,
      }
    );
    const { writes, ...view } = plan;
    if (body.apply !== true) {
      res.json({ ...view, applied: false });
      return;
    }
    if (plan.errors.length) throw new PosError("import_has_errors", 422, { errors: plan.errors });
    // Commissions and the default are the owner's: a privileged manager imports costs only.
    if (storeIds !== null && (writes.rules.length || writes.sellers.length || writes.defaultPct !== undefined)) throw new PosError("forbidden_role", 403);

    const svc = req.scope.resolve<StoreCostModuleService>(STORE_COST_MODULE);
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const item of writes.costCreates) {
      const created = (await svc.createCostItems({ ...item, allocation: item.allocation as unknown as Record<string, unknown>, created_by: scope.user_id, updated_by: scope.user_id } as never)) as unknown as { id: string };
      await recordAudit(req.scope, { actorId: scope.user_id, action: "cost.change", entity: "cost_item", entityId: created.id, establishmentId: item.establishment_id, after: { ...item, via: "import" } });
    }
    for (const { id, item } of writes.costUpdates) {
      await svc.updateCostItems({ id, ...item, allocation: item.allocation as unknown as Record<string, unknown>, updated_by: scope.user_id } as never);
      await recordAudit(req.scope, { actorId: scope.user_id, action: "cost.change", entity: "cost_item", entityId: id, establishmentId: item.establishment_id, before: byId.get(id) ?? null, after: { ...item, via: "import" } });
    }
    if (writes.rules.length) {
      const saved = await upsertCostRules(req.scope, writes.rules);
      await recordAudit(req.scope, { actorId: scope.user_id, action: "cost.change", entity: "cost_rule", entityId: "import", after: { rules: writes.rules.map((r) => ({ kind: r.kind, match_key: r.match_key, amount: r.amount, active: r.active })) } });
      void mirrorCostRulesToSheet(req.scope, saved);
    }
    if (writes.defaultPct !== undefined && writes.defaultPct !== null) {
      await saveDefaultCommissionPct(req.scope, writes.defaultPct, scope.user_id);
      await recordAudit(req.scope, { actorId: scope.user_id, action: "settings.change", entity: "commission_default", entityId: "default_commission_pct", before: { pct: defaultPct }, after: { pct: writes.defaultPct, via: "import" } });
    }
    if (writes.sellers.length) {
      const sellerSvc = sellerService(req.scope);
      for (const s of writes.sellers) {
        const current = sellers.find((x) => x.id === s.id);
        await sellerSvc.updateSellers([{ id: s.id, commission_pct: s.pct }] as never);
        await recordAudit(req.scope, { actorId: scope.user_id, action: "settings.change", entity: "seller", entityId: s.id, establishmentId: current?.establishment_id ?? null, before: { commission_pct: current ? Number(current.commission_pct) : null }, after: { commission_pct: s.pct, via: "import" } });
      }
    }
    void mirrorPricesToSheet(req.scope);
    res.json({ ...view, applied: true });
  });
}
