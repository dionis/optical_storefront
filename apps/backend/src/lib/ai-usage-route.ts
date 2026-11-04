import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getStaffScope } from "./staff-scope";

/**
 * Shared by /admin/ai-usage/*. Only the owner and superadmins see AI spending:
 * staffGuard already refuses these routes to every restricted role (they are
 * not in staff-roles.ts), and this repeats it so the rule does not depend on
 * an allowlist staying as it is. A secret API key (the scraper reporting its
 * translations) has no user and is only accepted where `allowApiKey` says so.
 */
export class AiUsageError extends Error {
  constructor(public reason: string, public status = 422) {
    super(reason);
  }
}

export async function aiActor(req: AuthenticatedMedusaRequest, { allowApiKey = false } = {}): Promise<string | null> {
  const ctx = req.auth_context;
  if (ctx?.actor_type === "user" && ctx.actor_id) {
    const scope = await getStaffScope(req.scope, ctx.actor_id);
    if (!scope.is_admin) throw new AiUsageError("forbidden_role", 403);
    return ctx.actor_id;
  }
  if (allowApiKey && ctx?.actor_type === "api-key") return null;
  throw new AiUsageError("forbidden_role", 403);
}

export async function aiHandler(req: AuthenticatedMedusaRequest, res: MedusaResponse, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AiUsageError) {
      res.status(e.status).json({ type: "invalid_data", reason: e.reason, message: `AI usage: ${e.reason}` });
      return;
    }
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[ai-usage] ${req.method} ${req.url}: ${(e as Error).stack ?? e}`);
    res.status(500).json({ type: "unexpected_state", reason: "ai_usage_failed", message: "The AI usage request failed." });
  }
}

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive) → [from, to+1day). Default: the last 30 days. */
export function parseRange(q: Record<string, unknown>, now = new Date()): { from: Date; to: Date } {
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);
  const to = day(q.to);
  const from = day(q.from);
  const end = to ? new Date(to.getTime() + 86_400_000) : new Date(now.getTime() + 60_000);
  const start = from ?? new Date(end.getTime() - 30 * 86_400_000);
  if (start >= end) throw new AiUsageError("invalid_range");
  if (end.getTime() - start.getTime() > 400 * 86_400_000) throw new AiUsageError("range_too_long");
  return { from: start, to: end };
}
