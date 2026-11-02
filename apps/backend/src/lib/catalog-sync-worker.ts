import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";

const WORKER_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

/**
 * The worker routes are for the scraper worker, which authenticates with a
 * secret admin API key — never for a person in the panel. A logged-in owner
 * reporting "progress" on a run would only corrupt its history.
 *
 * Returns the worker id, or answers the request and returns null.
 */
export function workerIdOf(req: AuthenticatedMedusaRequest, res: MedusaResponse): string | null {
  if (req.auth_context?.actor_type !== "api-key") {
    res.status(403).json({ type: "not_allowed", reason: "worker_only", message: "Worker routes need a secret API key." });
    return null;
  }
  const raw = (req.body as Record<string, unknown> | undefined)?.worker_id;
  if (typeof raw !== "string" || !WORKER_ID_RE.test(raw)) {
    res.status(422).json({ type: "invalid_data", reason: "invalid_worker_id", message: "worker_id is required." });
    return null;
  }
  return raw;
}
