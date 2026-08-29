import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { INotificationModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { notificationHealth, undeliverableReason } from "../../../lib/notification-health";

/**
 * Delivers the "your measurement is ready" message vision-measure could not send
 * itself — that service is deliberately stateless (no credentials, no DB, see
 * CLAUDE.md), so it composes the text and calls here for the actual send. This is
 * the ONE route in this folder that runs the OTHER direction: every other file
 * next to it (route.ts, job/, models/, health/, image-proxy/) proxies FROM Medusa
 * TO vision-measure; this one is called FROM vision-measure INTO Medusa.
 *
 * Unauthenticated by design — vision-measure has no operator session to present —
 * so VISION_INTERNAL_SECRET plus the rate limit in rate-limit.ts are what stand
 * between this route and an open spam relay. Both are optional so a deployment
 * without them still works end to end in dev.
 */

interface NotifyBody {
  email?: string | null;
  whatsapp?: string | null;
  subject?: string | null;
  text: string;
  requestId?: string | null;
}

function checkSharedSecret(req: MedusaRequest): boolean {
  const expected = (process.env.VISION_INTERNAL_SECRET || "").trim();
  if (!expected) return true; // not configured: same "degrade, don't crash" contract as Resend/Twilio
  const header = req.headers["x-vision-internal-key"];
  const provided = Array.isArray(header) ? header[0] : header;
  return provided === expected;
}

/** Twilio's WhatsApp channel is the SMS endpoint with a `whatsapp:` prefix on `to`. */
function toWhatsAppRecipient(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!checkSharedSecret(req)) {
    res.status(401).json({ ok: false, error: "Invalid or missing internal key." });
    return;
  }

  const body = (req.body || {}) as NotifyBody;
  const email = (body.email || "").trim();
  const whatsapp = (body.whatsapp || "").trim();
  const text = (body.text || "").trim();

  if (!text) {
    res.status(422).json({ ok: false, error: "'text' is required." });
    return;
  }
  if (!email && !whatsapp) {
    res.status(422).json({ ok: false, error: "Provide 'email' or 'whatsapp'." });
    return;
  }

  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const notificationService = req.scope.resolve<INotificationModuleService>(Modules.NOTIFICATION);
  const health = notificationHealth();
  const subject = (body.subject || "").trim() || "RUBILENS";
  const requestId = body.requestId || "sin-id";

  const delivered: { email?: boolean; whatsapp?: boolean } = {};
  const errors: string[] = [];

  if (email) {
    const reason = undeliverableReason(health.email);
    if (reason) logger.warn(`[vision-measure-notify] ${requestId} email ${reason}`);
    try {
      await notificationService.createNotifications({
        to: email,
        channel: "email",
        template: "vision-measure-result",
        trigger_type: "vision-measure.ready",
        resource_id: requestId,
        resource_type: "vision-measure-job",
        content: { subject, text },
        data: { request_id: requestId },
      });
      delivered.email = health.email.configured;
    } catch (error) {
      errors.push(`email: ${(error as Error).message}`);
      logger.error(`[vision-measure-notify] ${requestId} email failed: ${(error as Error).message}`);
    }
  }

  if (whatsapp) {
    const reason = undeliverableReason(health.whatsapp);
    if (reason) logger.warn(`[vision-measure-notify] ${requestId} whatsapp ${reason}`);
    try {
      await notificationService.createNotifications({
        to: toWhatsAppRecipient(whatsapp),
        channel: "whatsapp",
        template: "vision-measure-result-whatsapp",
        trigger_type: "vision-measure.ready",
        resource_id: requestId,
        resource_type: "vision-measure-job",
        content: { subject: "", text },
        data: { request_id: requestId },
      });
      delivered.whatsapp = health.whatsapp.configured;
    } catch (error) {
      errors.push(`whatsapp: ${(error as Error).message}`);
      logger.error(`[vision-measure-notify] ${requestId} whatsapp failed: ${(error as Error).message}`);
    }
  }

  // 200 even with a partial failure: vision-measure logs `errors` and moves on, the same
  // "one channel failing must not hide the other" contract order-placed.ts already uses.
  res.status(200).json({ ok: errors.length === 0, delivered, errors });
}
