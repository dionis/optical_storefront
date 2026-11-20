/**
 * AI CONSUMPTION AND CREDIT — the database half. Pure rules: ai-usage.ts.
 *
 *   recordAiUsage      every paid call (OCR, vision-measure, Medios, the scraper's
 *                      translation) — best-effort, never throws: a failed write
 *                      must not fail the customer's request.
 *   aiUsageReport      the panel: balances, pace, breakdown by activity/model/day.
 *   runAiCreditAlerts  the job: low-balance rules and "out of credit" refusals.
 */
import type { INotificationModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, generateEntityId, Modules } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import {
  AI_PROVIDERS,
  alertShouldFire,
  alertTripped,
  burnWindowStart,
  cleanUsageEvent,
  creditCycle,
  providerBalance,
  providerState,
  type CleanAlert,
  type CleanEntry,
  type CreditCycle,
  type EntryLike,
  type ProviderBalance,
} from "./ai-usage";
import { renderLowBalanceEmail, renderNoCreditEmail } from "./email/ai-credit-emails";
import { resolveStoreSettings } from "./store-settings";
import { tenant } from "./tenant";

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const logOf = (c: MedusaContainer) => c.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
const num = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Minimum time between two "out of credit" emails for the same provider. */
const NO_CREDIT_EMAIL_EVERY_MS = 6 * 3_600_000;

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Records one call. Returns false when the input was rejected or the write
 * failed; callers ignore it — consumption tracking never breaks the feature.
 * A repeated `event_key` is a no-op (polled results, retried reports).
 */
export async function recordAiUsage(container: MedusaContainer, raw: Record<string, unknown>): Promise<boolean> {
  const cleaned = cleanUsageEvent(raw);
  if ("reason" in cleaned) {
    logOf(container).warn(`[ai-usage] event rejected (${cleaned.reason}): ${String(raw.provider)}/${String(raw.activity)}`);
    return false;
  }
  const e = cleaned.event;
  try {
    await pgOf(container).raw(
      `INSERT INTO ai_usage_event
         (id, provider, model, activity, status, input_tokens, output_tokens, cost_usd, priced, rate_note, event_key, ref_id, establishment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`,
      [
        generateEntityId("", "aiu"),
        e.provider, e.model, e.activity, e.status, e.input_tokens, e.output_tokens,
        e.cost_usd, e.priced, e.rate_note, e.event_key, e.ref_id, e.establishment_id,
      ]
    );
    return true;
  } catch (err) {
    logOf(container).error(`[ai-usage] could not record ${e.provider}/${e.activity}: ${(err as Error).message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Credit entries and alerts (owner's configuration)
// ---------------------------------------------------------------------------

export interface EntryRow extends EntryLike {
  provider: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export async function listEntries(container: MedusaContainer): Promise<EntryRow[]> {
  const { rows } = await pgOf(container).raw(
    `SELECT id, provider, kind, amount_usd, effective_at, note, created_by, created_at
       FROM ai_credit_entry WHERE deleted_at IS NULL ORDER BY effective_at DESC, id DESC LIMIT 500`
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    provider: String(r.provider),
    kind: String(r.kind),
    amount_usd: num(r.amount_usd),
    effective_at: iso(r.effective_at) as string,
    note: (r.note as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
    created_at: iso(r.created_at) as string,
  }));
}

export async function createEntry(container: MedusaContainer, entry: CleanEntry, actorId: string | null): Promise<string> {
  const id = generateEntityId("", "aicr");
  await pgOf(container).raw(
    `INSERT INTO ai_credit_entry (id, provider, kind, amount_usd, effective_at, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, entry.provider, entry.kind, entry.amount_usd, entry.effective_at.toISOString(), entry.note, actorId]
  );
  return id;
}

export async function deleteEntry(container: MedusaContainer, id: string): Promise<EntryRow | null> {
  const { rows } = await pgOf(container).raw(
    `UPDATE ai_credit_entry SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL
     RETURNING id, provider, kind, amount_usd, effective_at, note, created_by, created_at`,
    [id]
  );
  const r = (rows as Record<string, unknown>[])[0];
  return r ? { id: String(r.id), provider: String(r.provider), kind: String(r.kind), amount_usd: num(r.amount_usd), effective_at: iso(r.effective_at) as string, note: (r.note as string | null) ?? null, created_by: null, created_at: iso(r.created_at) as string } : null;
}

export interface AlertRow {
  id: string;
  provider: string;
  unit: string;
  threshold: number;
  recipients: string[];
  locale: string;
  is_active: boolean;
  fired_cycle: string | null;
  fired_at: string | null;
}

export async function listAlerts(container: MedusaContainer): Promise<AlertRow[]> {
  const { rows } = await pgOf(container).raw(
    `SELECT id, provider, unit, threshold, recipients, locale, is_active, fired_cycle, fired_at
       FROM ai_credit_alert WHERE deleted_at IS NULL ORDER BY provider, unit, threshold DESC`
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    provider: String(r.provider),
    unit: String(r.unit),
    threshold: num(r.threshold),
    recipients: Array.isArray(r.recipients) ? (r.recipients as string[]) : [],
    locale: String(r.locale ?? "es"),
    is_active: Boolean(r.is_active),
    fired_cycle: (r.fired_cycle as string | null) ?? null,
    fired_at: iso(r.fired_at),
  }));
}

export async function createAlert(container: MedusaContainer, a: CleanAlert, actorId: string | null): Promise<string> {
  const id = generateEntityId("", "aial");
  await pgOf(container).raw(
    `INSERT INTO ai_credit_alert (id, provider, unit, threshold, recipients, locale, is_active, created_by) VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?)`,
    [id, a.provider, a.unit, a.threshold, JSON.stringify(a.recipients), a.locale, a.is_active, actorId]
  );
  return id;
}

/** Editing the rule re-arms it: a new threshold deserves its own warning. */
export async function updateAlert(container: MedusaContainer, id: string, a: CleanAlert): Promise<boolean> {
  const { rows } = await pgOf(container).raw(
    `UPDATE ai_credit_alert SET provider = ?, unit = ?, threshold = ?, recipients = ?::jsonb, locale = ?, is_active = ?,
            fired_cycle = NULL, fired_at = NULL, updated_at = NOW()
      WHERE id = ? AND deleted_at IS NULL RETURNING id`,
    [a.provider, a.unit, a.threshold, JSON.stringify(a.recipients), a.locale, a.is_active, id]
  );
  return (rows as unknown[]).length > 0;
}

export async function deleteAlert(container: MedusaContainer, id: string): Promise<boolean> {
  const { rows } = await pgOf(container).raw(`UPDATE ai_credit_alert SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL RETURNING id`, [id]);
  return (rows as unknown[]).length > 0;
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export interface ProviderOverview extends ProviderBalance {
  provider: string;
  cycle_id: string | null;
  cycle_start: string | null;
  anchor_kind: string | null;
  last_no_credit_at: string | null;
  state: ReturnType<typeof providerState>;
  tripped_alerts: string[];
}

interface Overview {
  providers: ProviderOverview[];
  cycles: Map<string, CreditCycle>;
  entries: EntryRow[];
  alerts: AlertRow[];
}

/** Balance and pace of every provider that has an entry, an alert or any recorded call. */
export async function providerOverview(container: MedusaContainer, now = new Date()): Promise<Overview> {
  const pg = pgOf(container);
  const [entries, alerts, seen] = await Promise.all([
    listEntries(container),
    listAlerts(container),
    pg.raw(
      `SELECT provider, MAX(created_at) FILTER (WHERE status = 'no_credit') AS last_no_credit
         FROM ai_usage_event WHERE deleted_at IS NULL GROUP BY provider`
    ),
  ]);
  const lastNoCredit = new Map<string, Date | null>();
  for (const r of seen.rows as Record<string, unknown>[]) lastNoCredit.set(String(r.provider), r.last_no_credit ? new Date(r.last_no_credit as string) : null);

  const names = AI_PROVIDERS.filter((p) => lastNoCredit.has(p) || entries.some((e) => e.provider === p) || alerts.some((a) => a.provider === p));
  const cycles = new Map<string, CreditCycle>();
  const providers: ProviderOverview[] = [];
  for (const p of names) {
    const cycle = creditCycle(entries.filter((e) => e.provider === p));
    cycles.set(p, cycle);
    const windowStart = burnWindowStart(cycle, now);
    const { rows } = await pg.raw(
      `SELECT COALESCE(SUM(cost_usd) FILTER (WHERE ?::timestamptz IS NULL OR created_at >= ?::timestamptz), 0) AS since_start,
              COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= ?::timestamptz), 0) AS in_window
         FROM ai_usage_event WHERE provider = ? AND status = 'ok' AND deleted_at IS NULL`,
      [iso(cycle.start), iso(cycle.start), windowStart.toISOString(), p]
    );
    const r = (rows as Record<string, unknown>[])[0] ?? {};
    const bal = providerBalance(cycle, num(r.since_start), num(r.in_window), now);
    const tripped = alerts.filter((a) => a.provider === p && alertTripped(a, bal)).map((a) => a.id);
    providers.push({
      provider: p,
      ...bal,
      cycle_id: cycle.cycle_id,
      cycle_start: iso(cycle.start),
      anchor_kind: cycle.anchor_kind,
      last_no_credit_at: iso(lastNoCredit.get(p)),
      state: providerState(bal, tripped.length, lastNoCredit.get(p) ?? null, now),
      tripped_alerts: tripped,
    });
  }
  return { providers, cycles, entries, alerts };
}

/** How many providers need attention — the panel's badge. */
export async function aiCreditAttention(container: MedusaContainer): Promise<number> {
  const { providers } = await providerOverview(container);
  return providers.filter((p) => p.state === "low" || p.state === "empty" || p.state === "no_credit").length;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ReportRange {
  from: Date;
  to: Date;
  provider?: string | null;
  activity?: string | null;
}

/** Everything the «Consumo IA» tab shows, for one date range. Days are in the store's time zone. */
export async function aiUsageReport(container: MedusaContainer, range: ReportRange) {
  const pg = pgOf(container);
  const tz = tenant().timezone;
  const where = `deleted_at IS NULL AND created_at >= ? AND created_at < ?
                 AND (?::text IS NULL OR provider = ?) AND (?::text IS NULL OR activity = ?)`;
  const binds = [range.from.toISOString(), range.to.toISOString(), range.provider ?? null, range.provider ?? null, range.activity ?? null, range.activity ?? null];

  const [overview, totals, byActivity, byModel, byDay, events] = await Promise.all([
    providerOverview(container),
    pg.raw(
      `SELECT COUNT(*) FILTER (WHERE status = 'ok') AS calls,
              COUNT(*) FILTER (WHERE status = 'no_credit') AS refused,
              COUNT(*) FILTER (WHERE status = 'ok' AND priced = 'unpriced') AS unpriced,
              COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM ai_usage_event WHERE ${where}`,
      binds
    ),
    pg.raw(
      `SELECT provider, activity, COUNT(*) FILTER (WHERE status = 'ok') AS calls,
              COUNT(*) FILTER (WHERE status = 'no_credit') AS refused,
              COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM ai_usage_event WHERE ${where} GROUP BY provider, activity ORDER BY cost DESC`,
      binds
    ),
    pg.raw(
      `SELECT provider, COALESCE(model, '') AS model, COUNT(*) FILTER (WHERE status = 'ok') AS calls,
              COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) FILTER (WHERE status = 'ok' AND priced = 'unpriced') AS unpriced
         FROM ai_usage_event WHERE ${where} GROUP BY provider, model ORDER BY cost DESC LIMIT 50`,
      binds
    ),
    pg.raw(
      `SELECT to_char(created_at AT TIME ZONE ?, 'YYYY-MM-DD') AS day, provider, COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls
         FROM ai_usage_event WHERE ${where} AND status = 'ok' GROUP BY 1, 2 ORDER BY 1`,
      [tz, ...binds]
    ),
    pg.raw(
      `SELECT id, created_at, provider, model, activity, status, input_tokens, output_tokens, cost_usd, priced, ref_id, establishment_id
         FROM ai_usage_event WHERE ${where} ORDER BY created_at DESC LIMIT 500`,
      binds
    ),
  ]);

  const t = (totals.rows as Record<string, unknown>[])[0] ?? {};
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), timezone: tz },
    providers: overview.providers,
    entries: overview.entries,
    alerts: overview.alerts.map((a) => ({ ...a, tripped: overview.providers.some((p) => p.tripped_alerts.includes(a.id)) })),
    totals: { calls: num(t.calls), refused: num(t.refused), unpriced: num(t.unpriced), cost_usd: num(t.cost), input_tokens: num(t.input_tokens), output_tokens: num(t.output_tokens) },
    by_activity: (byActivity.rows as Record<string, unknown>[]).map((r) => ({
      provider: String(r.provider), activity: String(r.activity), calls: num(r.calls), refused: num(r.refused), cost_usd: num(r.cost),
      avg_usd: num(r.calls) ? num(r.cost) / num(r.calls) : 0, input_tokens: num(r.input_tokens), output_tokens: num(r.output_tokens),
    })),
    by_model: (byModel.rows as Record<string, unknown>[]).map((r) => ({ provider: String(r.provider), model: String(r.model) || null, calls: num(r.calls), cost_usd: num(r.cost), unpriced: num(r.unpriced) })),
    by_day: (byDay.rows as Record<string, unknown>[]).map((r) => ({ day: String(r.day), provider: String(r.provider), cost_usd: num(r.cost), calls: num(r.calls) })),
    events: (events.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), created_at: iso(r.created_at), provider: String(r.provider), model: (r.model as string | null) ?? null,
      activity: String(r.activity), status: String(r.status), input_tokens: r.input_tokens == null ? null : num(r.input_tokens),
      output_tokens: r.output_tokens == null ? null : num(r.output_tokens), cost_usd: num(r.cost_usd), priced: String(r.priced),
      ref_id: (r.ref_id as string | null) ?? null, establishment_id: (r.establishment_id as string | null) ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Alerts job
// ---------------------------------------------------------------------------

async function sendEmail(container: MedusaContainer, to: string, content: { subject: string; html: string; text: string }, resourceId: string): Promise<boolean> {
  try {
    await container.resolve<INotificationModuleService>(Modules.NOTIFICATION).createNotifications({
      to,
      channel: "email",
      template: "ai-credit-alert",
      trigger_type: "ai.credit",
      resource_id: resourceId,
      resource_type: "ai_credit_alert",
      content,
    });
    return true;
  } catch (e) {
    logOf(container).error(`[ai-usage] alert email to ${to} failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Low-balance rules fire once per funding cycle; "out of credit" refusals send
 * one email per provider at most every 6 hours, to the admin list plus every
 * recipient of that provider's rules. Idempotent: safe to run as often as wanted.
 */
export async function runAiCreditAlerts(container: MedusaContainer, now = new Date()): Promise<{ low: number; no_credit: number }> {
  const pg = pgOf(container);
  const settings = await resolveStoreSettings(container);
  const admins = settings.admin_notification_emails ?? [];
  const { providers, cycles, alerts } = await providerOverview(container, now);
  let low = 0;

  for (const alert of alerts) {
    const bal = providers.find((p) => p.provider === alert.provider);
    const cycle = cycles.get(alert.provider);
    if (!bal || !cycle || !alertShouldFire(alert, bal, cycle)) continue;
    // Claim the cycle first: two overlapping runs must not both send.
    const claimed = await pg.raw(
      `UPDATE ai_credit_alert SET fired_cycle = ?, fired_at = NOW() WHERE id = ? AND fired_cycle IS DISTINCT FROM ? RETURNING id`,
      [cycle.cycle_id, alert.id, cycle.cycle_id]
    );
    if (!(claimed.rows as unknown[]).length) continue;
    const to = alert.recipients.length ? alert.recipients : admins;
    const locale = alert.locale === "en" ? "en" : "es";
    const mail = renderLowBalanceEmail({ provider: bal.provider, unit: alert.unit, threshold: alert.threshold, remaining: bal.remaining, funded: bal.funded, spent: bal.spent, burn_per_day: bal.burn_per_day, days_left: bal.days_left }, locale);
    for (const addr of to) await sendEmail(container, addr, mail, alert.id);
    if (!to.length) logOf(container).warn(`[ai-usage] alert ${alert.id} fired with no recipients (no admin emails configured)`);
    low += 1;
  }

  // "Out of credit": every refusal not yet reported, grouped by provider.
  const pending = await pg.raw(
    `SELECT provider, MIN(created_at) AS since, COUNT(*) AS n, array_agg(DISTINCT activity) AS activities
       FROM ai_usage_event WHERE status = 'no_credit' AND notified_at IS NULL AND deleted_at IS NULL GROUP BY provider`
  );
  let noCredit = 0;
  for (const r of pending.rows as Record<string, unknown>[]) {
    const provider = String(r.provider);
    const recent = await pg.raw(
      `SELECT 1 FROM ai_usage_event WHERE provider = ? AND status = 'no_credit' AND notified_at > ? LIMIT 1`,
      [provider, new Date(now.getTime() - NO_CREDIT_EMAIL_EVERY_MS).toISOString()]
    );
    const marked = await pg.raw(
      `UPDATE ai_usage_event SET notified_at = NOW() WHERE provider = ? AND status = 'no_credit' AND notified_at IS NULL RETURNING id`,
      [provider]
    );
    if ((recent.rows as unknown[]).length || !(marked.rows as unknown[]).length) continue;
    const to = [...new Set([...admins, ...alerts.filter((a) => a.provider === provider && a.is_active).flatMap((a) => a.recipients)])];
    const byLocale = new Map<string, string>();
    for (const a of alerts) if (a.provider === provider) for (const e of a.recipients) byLocale.set(e, a.locale);
    for (const addr of to) {
      const locale = byLocale.get(addr) === "en" ? "en" : "es";
      await sendEmail(container, addr, renderNoCreditEmail({ provider, since: new Date(r.since as string), count: num(r.n), activities: (r.activities as string[]) ?? [] }, locale), `no_credit:${provider}`);
    }
    noCredit += 1;
  }
  return { low, no_credit: noCredit };
}
