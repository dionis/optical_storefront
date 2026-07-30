/**
 * Resend notification provider for Medusa v2.
 *
 * Talks to the Resend REST API over plain `fetch` — no SDK dependency, since the
 * payload is a single JSON POST. Message bodies are rendered by the caller and
 * arrive in `notification.content`; this provider only ships an already-composed
 * message, so template changes never require touching it.
 *
 * Resend refuses any `from` outside a domain verified on the account. While the
 * store still sends as `onboarding@resend.dev` (Resend's shared sandbox sender),
 * delivery is restricted to the Resend account's own address — every other
 * recipient comes back 403. Verify a domain and switch RESEND_FROM_EMAIL to it
 * before real customers are in the loop.
 */

import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils";
import type {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types";

const RESEND_API_URL = "https://api.resend.com/emails";

export interface ResendOptions {
  /** Resend API key (`re_...`). */
  api_key: string;
  /** Default sender, overridable per notification. */
  from: string;
}

interface InjectedDependencies {
  logger: Logger;
}

interface ResendErrorBody {
  message?: string;
  name?: string;
}

interface ResendSuccessBody {
  id?: string;
}

/** Normalizes the several shapes a recipient list can arrive in. */
function toRecipients(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

export class ResendNotificationService extends AbstractNotificationProviderService {
  static identifier = "notification-resend";

  private readonly options_: ResendOptions;
  private readonly logger_: Logger;

  constructor({ logger }: InjectedDependencies, options: ResendOptions) {
    super();
    this.options_ = options;
    this.logger_ = logger;
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.api_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Resend notification provider requires 'api_key' (RESEND_API_KEY)."
      );
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Resend notification provider requires 'from' (RESEND_FROM_EMAIL)."
      );
    }
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No notification information provided."
      );
    }

    const to = toRecipients(notification.to);
    if (!to.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The notification has no recipient."
      );
    }

    const content = notification.content;
    if (!content?.subject || (!content.html && !content.text)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Notification '${notification.template}' must carry a subject and an html or text body. ` +
          "Resend has no server-side template registry — render the body before dispatching."
      );
    }

    const providerData = notification.provider_data ?? {};

    const payload: Record<string, unknown> = {
      from: notification.from?.trim() || this.options_.from,
      to,
      subject: content.subject,
    };

    if (content.html) {
      payload.html = content.html;
    }
    if (content.text) {
      payload.text = content.text;
    }

    const cc = toRecipients(providerData.cc);
    if (cc.length) {
      payload.cc = cc;
    }
    const bcc = toRecipients(providerData.bcc);
    if (bcc.length) {
      payload.bcc = bcc;
    }
    const replyTo = toRecipients(providerData.reply_to);
    if (replyTo.length) {
      payload.reply_to = replyTo;
    }

    if (Array.isArray(notification.attachments) && notification.attachments.length) {
      payload.attachments = notification.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        content_type: attachment.content_type,
      }));
    }

    let response: Response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options_.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Could not reach the Resend API: ${(error as Error).message}`
      );
    }

    const body = (await response.json().catch(() => ({}))) as
      | ResendErrorBody
      | ResendSuccessBody;

    if (!response.ok) {
      const detail = (body as ResendErrorBody).message ?? "unknown error";
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Resend rejected the email (${response.status}): ${detail}`
      );
    }

    const id = (body as ResendSuccessBody).id;
    this.logger_.info(`[notification-resend] sent '${notification.template}' to ${to.join(", ")} (${id ?? "no id"})`);

    return { id };
  }
}

export default ResendNotificationService;
