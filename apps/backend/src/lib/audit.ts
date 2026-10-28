import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { AUDIT_MODULE } from "../modules/audit";
import type AuditModuleService from "../modules/audit/service";

/**
 * Audit log (HU-72, HU-97): insert-only. Every write is best-effort — an audit
 * hiccup is logged, never allowed to undo the change it records.
 *
 * Never put prescription values or insurance data in `before`/`after`.
 */
export const AUDIT_ACTIONS = [
  "price.change",
  "price.import",
  "role.change",
  "stores.change",
  "privileges.change",
  "profile.change",
  "discount.request",
  "discount.approve",
  "discount.reject",
  "sale.void",
  "sale.void_request",
  "payment.method",
  "payment.collect",
  "insurance.paid",
  "document.print",
  "cost.change",
  "cash.close",
  "settings.change",
  "alert.rule",
  "assortment.change",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditInput {
  actorId: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  establishmentId?: string | null;
  before?: unknown;
  after?: unknown;
}

const json = (v: unknown): Record<string, unknown> | null =>
  v === undefined || v === null ? null : (JSON.parse(JSON.stringify(v)) as Record<string, unknown>);

export async function recordAudit(container: MedusaContainer, input: AuditInput): Promise<void> {
  try {
    await container.resolve<AuditModuleService>(AUDIT_MODULE).createAuditEvents({
      actor_user_id: input.actorId,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      establishment_id: input.establishmentId ?? null,
      before: json(input.before),
      after: json(input.after),
    });
  } catch (e) {
    container
      .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
      .error(`[audit] could not record ${input.action} on ${input.entity} ${input.entityId ?? ""}: ${(e as Error).message}`);
  }
}

export interface AuditRow {
  id: string;
  actor_user_id: string | null;
  establishment_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}

export async function listAudit(
  container: MedusaContainer,
  filters: { action?: string; entity?: string; entityId?: string; establishmentIds?: string[] | null },
  take = 200
): Promise<AuditRow[]> {
  const where: Record<string, unknown> = {};
  if (filters.action) where.action = filters.action;
  if (filters.entity) where.entity = filters.entity;
  if (filters.entityId) where.entity_id = filters.entityId;
  if (filters.establishmentIds) where.establishment_id = filters.establishmentIds;
  const rows = await container
    .resolve<AuditModuleService>(AUDIT_MODULE)
    .listAuditEvents(where as never, { take, order: { created_at: "DESC" } });
  return rows.map((r) => ({
    id: r.id,
    actor_user_id: r.actor_user_id ?? null,
    establishment_id: r.establishment_id ?? null,
    action: r.action,
    entity: r.entity,
    entity_id: r.entity_id ?? null,
    before: r.before ?? null,
    after: r.after ?? null,
    created_at: String(r.created_at),
  }));
}
