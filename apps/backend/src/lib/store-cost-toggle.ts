import type { MedusaContainer } from "@medusajs/framework/types";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import type StorePricingModuleService from "../modules/store-pricing/service";
import { recordAudit } from "./audit";

/**
 * Per-store ON/OFF of a cost — the owner's "each store can also enable/disable
 * costs", kept OUT of lib/costing.ts so the cost-sheet math stays one pure
 * function with one owner.
 *
 * Shape of the decision:
 *  - a cost rule (`cost_rule`, the template) or a cost item (`cost_item`, the
 *    store's fixed / variable costs) is ON unless a row says otherwise;
 *  - a row belongs to ONE store: turning a rule off in Katy never touches
 *    Houston, and "Todas las tiendas" (the master) has no switches at all —
 *    there the rule is simply active or not (`cost_rule.active`).
 *
 * `isEnabled` is pure and is what lib/costing.ts needs to call (see the
 * three-line change reported with this work); everything below it is the
 * loader and the audited write.
 */

export const TOGGLE_KINDS = ["rule", "cost"] as const;
export type ToggleKind = (typeof TOGGLE_KINDS)[number];

export interface CostToggleLike {
  establishment_id: string;
  ref_kind: string;
  ref_id: string;
  enabled: boolean;
}

export interface CostToggleRow extends CostToggleLike {
  id: string;
  created_by: string | null;
}

/**
 * Whether cost `refId` applies in store `storeId`. Absent row → enabled, and
 * `storeId` null (the master / the web, which is not an establishment) is
 * always enabled: a switch is a store's decision, never the owner's list.
 */
export function isEnabled(
  refId: string,
  storeId: string | null,
  toggles: CostToggleLike[],
  kind: ToggleKind = "rule"
): boolean {
  if (!storeId || !refId) return true;
  const row = toggles.find(
    (t) => t.establishment_id === storeId && t.ref_kind === kind && t.ref_id === refId
  );
  return row ? row.enabled !== false : true;
}

/** The ids a store has switched OFF, for the panel and for the sheet. */
export function disabledIds(storeId: string | null, toggles: CostToggleLike[], kind: ToggleKind = "rule"): string[] {
  if (!storeId) return [];
  return toggles
    .filter((t) => t.establishment_id === storeId && t.ref_kind === kind && t.enabled === false)
    .map((t) => t.ref_id);
}

/** Validation of a switch as the panel sends it; a `reason` code or null. */
export function toggleDenied(kind: unknown, refId: unknown, enabled: unknown): string | null {
  if (typeof kind !== "string" || !(TOGGLE_KINDS as readonly string[]).includes(kind)) return "bad_kind";
  if (typeof refId !== "string" || !refId.trim() || refId.length > 160) return "bad_ref";
  if (typeof enabled !== "boolean") return "bad_value";
  return null;
}

const svc = (c: MedusaContainer) => c.resolve<StorePricingModuleService>(STORE_PRICING_MODULE);

function toRow(r: Record<string, unknown>): CostToggleRow {
  return {
    id: String(r["id"]),
    establishment_id: String(r["establishment_id"] ?? ""),
    ref_kind: String(r["ref_kind"] ?? "rule"),
    ref_id: String(r["ref_id"] ?? ""),
    enabled: r["enabled"] !== false,
    created_by: (r["created_by"] as string | null) ?? null,
  };
}

/**
 * Every live switch, or only one store's. Never throws: an un-migrated table
 * must not take the cost sheet (or a sale) down — without rows everything is
 * enabled, which is what the shop did before this existed.
 */
export async function loadCostToggles(
  container: MedusaContainer,
  establishmentId?: string | null
): Promise<CostToggleRow[]> {
  try {
    const filters = establishmentId ? { establishment_id: establishmentId } : {};
    const rows = (await svc(container).listStoreCostToggles(filters as never, { take: 5000 })) as unknown as Record<
      string,
      unknown
    >[];
    return rows.filter((r) => !r["deleted_at"]).map(toRow);
  } catch {
    return [];
  }
}

/**
 * Turn a cost on or off for one store. Updates the row when it exists (so the
 * history is the audit log, not a pile of rows) and audits before / after.
 */
export async function setCostToggle(
  container: MedusaContainer,
  input: { establishmentId: string; kind: ToggleKind; refId: string; enabled: boolean },
  actorId: string | null
): Promise<CostToggleRow> {
  const service = svc(container);
  const existing = (await service.listStoreCostToggles(
    { establishment_id: input.establishmentId, ref_kind: input.kind, ref_id: input.refId } as never,
    { take: 1 }
  )) as unknown as Record<string, unknown>[];
  const current = existing.find((r) => !r["deleted_at"]);
  let row: CostToggleRow;
  if (current) {
    const [updated] = (await service.updateStoreCostToggles([
      { id: current["id"], enabled: input.enabled },
    ] as never)) as unknown as Record<string, unknown>[];
    row = toRow(updated ?? { ...current, enabled: input.enabled });
  } else {
    const created = (await service.createStoreCostToggles({
      establishment_id: input.establishmentId,
      ref_kind: input.kind,
      ref_id: input.refId,
      enabled: input.enabled,
      created_by: actorId,
    } as never)) as unknown as Record<string, unknown>;
    row = toRow(created);
  }
  await recordAudit(container, {
    actorId,
    action: "cost.change",
    entity: "store_cost_toggle",
    entityId: input.refId,
    establishmentId: input.establishmentId,
    before: current ? { kind: input.kind, enabled: current["enabled"] !== false } : null,
    after: { kind: input.kind, enabled: input.enabled },
  });
  return row;
}

export const DEFAULT_COMMISSION_KEY = "default_commission_pct";

/** The default seller commission the panel shows; null when the owner never set one. */
export async function loadDefaultCommissionPct(container: MedusaContainer): Promise<number | null> {
  try {
    const rows = (await svc(container).listPricingSettings(
      { key: DEFAULT_COMMISSION_KEY } as never,
      { take: 1 }
    )) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => !r["deleted_at"]);
    return row ? Math.round(Number(row["value"]) * 100) / 100 : null;
  } catch {
    return null;
  }
}

/** Writes the default seller commission (0–100). Audited by the caller's slice. */
export async function saveDefaultCommissionPct(
  container: MedusaContainer,
  pct: number,
  actorId: string | null
): Promise<number> {
  const service = svc(container);
  const value = Math.round(pct * 100) / 100;
  const rows = (await service.listPricingSettings(
    { key: DEFAULT_COMMISSION_KEY } as never,
    { take: 1 }
  )) as unknown as Record<string, unknown>[];
  const current = rows.find((r) => !r["deleted_at"]);
  if (current) {
    await service.updatePricingSettings([{ id: current["id"], value, updated_by: actorId }] as never);
  } else {
    await service.createPricingSettings({
      key: DEFAULT_COMMISSION_KEY,
      value,
      updated_by: actorId,
    } as never);
  }
  return value;
}
