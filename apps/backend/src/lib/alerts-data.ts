import type { INotificationModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { SALES_ALERT_MODULE } from "../modules/sales-alert";
import type SalesAlertModuleService from "../modules/sales-alert/service";
import { POS_MODULE } from "../modules/pos";
import type PosModuleService from "../modules/pos/service";
import {
  defaultRules,
  localParts,
  ruleMatches,
  storeIdle,
  summaryDue,
  type AlertEvent,
  type CleanRule,
  type RuleLike,
} from "./alerts";
import { resolveEmailLocale } from "./email/copy";
import { renderAlertEmail, renderDigestEmail, type DigestData } from "./email/alert-emails";
import { listEstablishments } from "./establishments";
import { storefrontOrigin } from "./order-access";
import { resolveStoreSettings } from "./store-settings";
import { tenant } from "./tenant";

/**
 * The alert engine (functional document E7): events come from the sale, void
 * and approval routes and from the order subscriber (web); the hourly job
 * sends summaries, the daily digest and "store without sales".
 *
 * Everything here is best-effort and never throws into the caller: an alert
 * that fails is recorded as failed in the history (HU-44), the sale stands.
 */

const svc = (c: MedusaContainer) => c.resolve<SalesAlertModuleService>(SALES_ALERT_MODULE);
const panelUrl = () => `${storefrontOrigin()}/admin?tab=possales`;

export interface RuleRow extends RuleLike {
  name: string;
  locale: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
}

const toRule = (r: Record<string, unknown>): RuleRow => ({
  id: String(r.id),
  name: String(r.name),
  event: String(r.event),
  conditions: (r.conditions as RuleLike["conditions"]) ?? {},
  establishment_ids: Array.isArray(r.establishment_ids) ? (r.establishment_ids as string[]) : null,
  seller_ids: Array.isArray(r.seller_ids) ? (r.seller_ids as string[]) : null,
  recipients: Array.isArray(r.recipients) ? (r.recipients as string[]) : [],
  mode: r.mode as RuleLike["mode"],
  schedule: (r.schedule as RuleLike["schedule"]) ?? null,
  is_active: Boolean(r.is_active),
  last_sent_at: r.last_sent_at ? new Date(r.last_sent_at as string).toISOString() : null,
  locale: String(r.locale ?? "es"),
  created_by: (r.created_by as string | null) ?? null,
  updated_by: (r.updated_by as string | null) ?? null,
  created_at: new Date(r.created_at as string).toISOString(),
});

export async function listRules(container: MedusaContainer): Promise<RuleRow[]> {
  await ensureDefaultRules(container);
  const rows = await svc(container).listAlertRules({}, { take: 500, order: { created_at: "ASC" } });
  return rows.map((r) => toRule(r as unknown as Record<string, unknown>));
}

/**
 * The agreed starting rules, created once (when no rule ever existed), mailed
 * to today's admin notification list — which reproduces the owner's current
 * per-order notice for the stores.
 */
export async function ensureDefaultRules(container: MedusaContainer): Promise<void> {
  const s = svc(container);
  const any = await s.listAlertRules({}, { take: 1, withDeleted: true });
  if (any.length) return;
  const settings = await resolveStoreSettings(container);
  const recipients = settings.admin_notification_emails;
  if (!recipients.length) return;
  const locale = tenant().locale === "en" ? "en" : "es";
  await s.createAlertRules(defaultRules(recipients, locale).map((r) => ({ ...r, created_by: "system" })) as never);
}

export async function createRule(container: MedusaContainer, rule: CleanRule, actorId: string): Promise<RuleRow> {
  const created = await svc(container).createAlertRules({ ...rule, created_by: actorId, updated_by: actorId } as never);
  return toRule(created as unknown as Record<string, unknown>);
}

export async function updateRule(container: MedusaContainer, id: string, rule: CleanRule, actorId: string): Promise<void> {
  await svc(container).updateAlertRules({ id, ...rule, updated_by: actorId } as never);
}

async function send(container: MedusaContainer, to: string, content: { subject: string; html: string; text: string }, resourceId: string): Promise<string | null> {
  try {
    await container.resolve<INotificationModuleService>(Modules.NOTIFICATION).createNotifications({
      to,
      channel: "email",
      template: "sales-alert",
      trigger_type: "sales.alert",
      resource_id: resourceId,
      resource_type: "alert_rule",
      content,
    });
    return null;
  } catch (e) {
    return (e as Error).message.slice(0, 300);
  }
}

/** Records an event for every matching rule; immediate rules mail now, the rest queue. */
export async function emitAlert(container: MedusaContainer, ev: AlertEvent): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  try {
    const rules = (await listRules(container)).filter((r) => ruleMatches(r, ev));
    const s = svc(container);
    for (const rule of rules) {
      for (const email of rule.recipients) {
        let row;
        try {
          row = await s.createAlertDeliveries({
            rule_id: rule.id,
            event: ev.event,
            event_key: ev.key,
            recipient_email: email,
            payload: { ...ev.data, is_web: ev.is_web ?? false } as Record<string, unknown>,
          });
        } catch (e) {
          if (/unique|duplicate/i.test((e as Error).message)) continue; // already handled
          throw e;
        }
        if (rule.mode !== "immediate") continue;
        const locale = resolveEmailLocale(rule.locale);
        const error = await send(container, email, renderAlertEmail(rule, [{ event: ev.event, data: { ...ev.data, is_web: ev.is_web } }], locale, panelUrl()), rule.id);
        await s.updateAlertDeliveries({ id: row.id, status: error ? "failed" : "sent", error, sent_at: error ? null : new Date() } as never);
      }
    }
  } catch (e) {
    logger.warn(`[alerts] ${ev.event} ${ev.key}: ${(e as Error).message}`);
  }
}

/** Sales of the period, by store and seller, for the digest (HU-43). */
async function digestData(container: MedusaContainer, rule: RuleRow, since: Date, now: Date, tz: string): Promise<DigestData> {
  const pos = container.resolve<PosModuleService>(POS_MODULE);
  const where: Record<string, unknown> = { created_at: { $gte: since, $lte: now } };
  if (rule.establishment_ids?.length) where.establishment_id = rule.establishment_ids;
  if (rule.seller_ids?.length) where.seller_id = rule.seller_ids;
  const sales = await pos.listPosSales(where as never, { take: 10000 });
  const stores = new Map((await listEstablishments(container)).map((s) => [s.id, `${s.code} · ${s.name}`]));
  const byStore = new Map<string, { label: string; count: number; total: number; voided: number }>();
  const bySeller = new Map<string, { label: string; count: number; total: number }>();
  let count = 0;
  let total = 0;
  for (const s of sales) {
    const st = byStore.get(s.establishment_id) ?? { label: stores.get(s.establishment_id) ?? s.establishment_id, count: 0, total: 0, voided: 0 };
    if (s.status === "voided") { st.voided++; byStore.set(s.establishment_id, st); continue; }
    const amount = Number(s.total_cents) / 100;
    st.count++; st.total += amount; byStore.set(s.establishment_id, st);
    const key = s.seller_code || s.seller_id || "—";
    const se = bySeller.get(key) ?? { label: key, count: 0, total: 0 };
    se.count++; se.total += amount; bySeller.set(key, se);
    count++; total += amount;
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    since: since.toLocaleString(rule.locale === "en" ? "en-US" : "es-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }),
    date: localParts(now, tz).date,
    stores: [...byStore.values()].map((s) => ({ ...s, total: round(s.total) })),
    sellers: [...bySeller.values()].sort((a, b) => b.total - a.total).map((s) => ({ ...s, total: round(s.total) })),
    count,
    total: round(total),
  };
}

/** Hourly: batched summaries, digests and idle stores. Never throws. */
export async function runAlertsJob(container: MedusaContainer, now = new Date()): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const tz = tenant().timezone;
  const s = svc(container);
  let rules: RuleRow[];
  try {
    rules = (await listRules(container)).filter((r) => r.is_active);
  } catch (e) {
    logger.warn(`[alerts] job could not load rules: ${(e as Error).message}`);
    return;
  }

  for (const rule of rules) {
    try {
      // "Store without sales": one event per store and day, then sent like any other.
      if (rule.event === "store.idle") {
        const after = rule.conditions?.idle_after ?? "14:00";
        const stores = (await listEstablishments(container)).filter((st) => st.is_active && (!rule.establishment_ids?.length || rule.establishment_ids.includes(st.id)));
        const pos = container.resolve<PosModuleService>(POS_MODULE);
        for (const st of stores) {
          const [last] = await pos.listPosSales({ establishment_id: st.id } as never, { take: 1, order: { created_at: "DESC" } });
          const lastAt = last ? new Date(last.created_at as unknown as string) : null;
          if (storeIdle({ now, tz, idleAfter: after, lastSaleAt: lastAt })) {
            await emitAlert(container, {
              event: "store.idle",
              key: `idle:${st.id}:${localParts(now, tz).date}`,
              establishment_id: st.id,
              seller_id: null,
              data: { store_code: st.code, store_name: st.name, after },
            });
          }
        }
      }
      if (!summaryDue(rule, now, tz)) continue;
      const locale = resolveEmailLocale(rule.locale);

      if (rule.event === "digest") {
        const since = rule.last_sent_at ? new Date(rule.last_sent_at) : new Date(now.getTime() - 24 * 3600_000);
        const data = await digestData(container, rule, since, now, tz);
        const key = `digest:${localParts(now, tz).date}:${localParts(now, tz).hour}`;
        for (const email of rule.recipients) {
          let row;
          try {
            row = await s.createAlertDeliveries({ rule_id: rule.id, event: "digest", event_key: key, recipient_email: email, payload: { count: data.count, total: data.total } });
          } catch {
            continue;
          }
          const error = await send(container, email, renderDigestEmail(rule, data, locale, panelUrl()), rule.id);
          await s.updateAlertDeliveries({ id: row.id, status: error ? "failed" : "sent", error, sent_at: error ? null : new Date() } as never);
        }
      } else {
        // Batched events: one mail per recipient with everything queued.
        const queued = await s.listAlertDeliveries({ rule_id: rule.id, status: "queued" } as never, { take: 2000, order: { created_at: "ASC" } });
        const byRecipient = new Map<string, typeof queued>();
        for (const d of queued) byRecipient.set(d.recipient_email, [...(byRecipient.get(d.recipient_email) ?? []), d]);
        for (const [email, rows] of byRecipient) {
          const events = rows.map((d) => ({ event: d.event, data: (d.payload ?? {}) as Record<string, unknown> }));
          const error = await send(container, email, renderAlertEmail(rule, events, locale, panelUrl()), rule.id);
          await s.updateAlertDeliveries(rows.map((d) => ({ id: d.id, status: error ? "failed" : "sent", error, sent_at: error ? null : new Date() })) as never);
        }
      }
      await s.updateAlertRules({ id: rule.id, last_sent_at: now } as never);
    } catch (e) {
      logger.warn(`[alerts] rule ${rule.id}: ${(e as Error).message}`);
    }
  }
}

export interface DeliveryRow {
  id: string;
  rule_id: string;
  event: string;
  recipient_email: string;
  status: string;
  error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  sent_at: string | null;
}

/** The history of alerts and whether they went out (HU-44). */
export async function listDeliveries(container: MedusaContainer, f: { ruleIds?: string[] | null; status?: string }, take = 200): Promise<DeliveryRow[]> {
  const where: Record<string, unknown> = {};
  if (f.ruleIds) where.rule_id = f.ruleIds;
  if (f.status) where.status = f.status;
  const rows = await svc(container).listAlertDeliveries(where as never, { take, order: { created_at: "DESC" } });
  return rows.map((d) => ({
    id: d.id,
    rule_id: d.rule_id,
    event: d.event,
    recipient_email: d.recipient_email,
    status: String(d.status),
    error: d.error ?? null,
    payload: (d.payload as Record<string, unknown> | null) ?? null,
    created_at: new Date(d.created_at as unknown as string).toISOString(),
    sent_at: d.sent_at ? new Date(d.sent_at as unknown as string).toISOString() : null,
  }));
}
