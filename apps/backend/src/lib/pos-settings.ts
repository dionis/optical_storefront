import type { MedusaContainer } from "@medusajs/framework/types";
import { POS_MODULE } from "../modules/pos";
import type PosModuleService from "../modules/pos/service";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./optical-change";

/**
 * Point-of-sale settings set by the owner or a superadmin (single row).
 *
 *  - Discount limits per role (HU-16). Owner's decision: configurable between
 *    0 % and 50 %, starting at seller 10 %, manager 15 %, supervisor 20 %; the
 *    owner and superadmins have no limit. A personal limit on the person's
 *    assignment (staff_assignment.discount_limit_pct) overrides the role's.
 *  - Optical change thresholds (HU-123): from how much change the "daño
 *    óptico" is flagged as significant, agreed by the owner with the optometrist.
 */

export const SETTING_ID = "default";
export const LIMITED_ROLES = ["seller", "manager", "supervisor"] as const;
export type LimitedRole = (typeof LIMITED_ROLES)[number];
export type DiscountLimits = Record<LimitedRole, number>;

export const DEFAULT_DISCOUNT_LIMITS: DiscountLimits = { seller: 10, manager: 15, supervisor: 20 };
export const MAX_DISCOUNT_LIMIT = 50;

export interface PosSettings {
  discount_limits: DiscountLimits;
  optical_thresholds: Thresholds;
  updated_by: string | null;
}

const clampPct = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(MAX_DISCOUNT_LIMIT, Math.max(0, Math.round(n * 100) / 100)) : fallback;
};

export function normalizeLimits(raw: unknown): DiscountLimits {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    seller: clampPct(r.seller, DEFAULT_DISCOUNT_LIMITS.seller),
    manager: clampPct(r.manager, DEFAULT_DISCOUNT_LIMITS.manager),
    supervisor: clampPct(r.supervisor, DEFAULT_DISCOUNT_LIMITS.supervisor),
  };
}

export function normalizeThresholds(raw: unknown): Thresholds {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof Thresholds, max: number) => {
    const n = Number(r[k]);
    return Number.isFinite(n) && n > 0 && n <= max ? n : DEFAULT_THRESHOLDS[k];
  };
  return { se: pick("se", 5), cyl: pick("cyl", 5), axis: pick("axis", 90), axisMinCyl: pick("axisMinCyl", 5), add: pick("add", 5) };
}

/** Validation of an owner's edit; returns a reason code or null. */
export function settingsDenied(body: { discount_limits?: unknown; optical_thresholds?: unknown }): string | null {
  if (body.discount_limits !== undefined) {
    const r = body.discount_limits as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return "bad_limits";
    for (const role of LIMITED_ROLES) {
      if (r[role] === undefined) continue;
      const n = Number(r[role]);
      if (!Number.isFinite(n) || n < 0 || n > MAX_DISCOUNT_LIMIT) return "bad_limits";
    }
  }
  if (body.optical_thresholds !== undefined) {
    const r = body.optical_thresholds as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return "bad_thresholds";
    for (const [k, max] of [["se", 5], ["cyl", 5], ["axis", 90], ["axisMinCyl", 5], ["add", 5]] as const) {
      if (r[k] === undefined) continue;
      const n = Number(r[k]);
      if (!Number.isFinite(n) || n <= 0 || n > max) return "bad_thresholds";
    }
  }
  return null;
}

/**
 * The discount limit that applies to a person: their personal limit if they
 * have one, else their role's; null = no limit (owner, superadmin).
 */
export function discountLimitFor(
  scope: { is_admin: boolean; role: string | null; discount_limit_pct: number | null },
  limits: DiscountLimits
): number | null {
  if (scope.is_admin) return null;
  if (scope.discount_limit_pct !== null && scope.discount_limit_pct !== undefined) return scope.discount_limit_pct;
  if (scope.role && (LIMITED_ROLES as readonly string[]).includes(scope.role)) return limits[scope.role as LimitedRole];
  return 0;
}

const svc = (c: MedusaContainer) => c.resolve<PosModuleService>(POS_MODULE);

export async function getPosSettings(container: MedusaContainer): Promise<PosSettings> {
  const [row] = await svc(container).listPosSettings({ id: SETTING_ID }, { take: 1 }).catch(() => []);
  return {
    discount_limits: normalizeLimits(row?.discount_limits),
    optical_thresholds: normalizeThresholds(row?.optical_thresholds),
    updated_by: (row?.updated_by as string | null) ?? null,
  };
}

export async function savePosSettings(
  container: MedusaContainer,
  patch: { discount_limits?: unknown; optical_thresholds?: unknown },
  actorId: string | null
): Promise<{ before: PosSettings; after: PosSettings }> {
  const before = await getPosSettings(container);
  const after: PosSettings = {
    discount_limits: patch.discount_limits !== undefined ? normalizeLimits({ ...before.discount_limits, ...(patch.discount_limits as object) }) : before.discount_limits,
    optical_thresholds: patch.optical_thresholds !== undefined ? normalizeThresholds({ ...before.optical_thresholds, ...(patch.optical_thresholds as object) }) : before.optical_thresholds,
    updated_by: actorId,
  };
  const s = svc(container);
  const [row] = await s.listPosSettings({ id: SETTING_ID }, { take: 1 });
  const data = {
    discount_limits: after.discount_limits as unknown as Record<string, unknown>,
    optical_thresholds: after.optical_thresholds as unknown as Record<string, unknown>,
    updated_by: actorId,
  };
  if (row) await s.updatePosSettings({ id: SETTING_ID, ...data });
  else await s.createPosSettings({ id: SETTING_ID, ...data });
  return { before, after };
}
