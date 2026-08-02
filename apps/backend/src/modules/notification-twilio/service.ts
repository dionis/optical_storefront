/**
 * Twilio SMS notification provider for Medusa v2.
 *
 * Talks to the Twilio REST API over plain `fetch` — no SDK dependency, since the
 * payload is a single form-encoded POST. Message bodies are rendered by the
 * caller and arrive in `notification.content.text`; this provider only ships an
 * already-composed message.
 *
 * Twilio only sends from a number (or Messaging Service) provisioned on the
 * account. Set TWILIO_FROM_NUMBER to an SMS-capable number in E.164 form
 * (e.g. +13055551234) or to a Messaging Service SID (starts with "MG"). Until a
 * real number is provisioned, keep the SMS channel on the logging fallback (see
 * medusa-config.ts) so a deployment without Twilio still boots.
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

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01/Accounts";

export interface TwilioOptions {
  /** Twilio Account SID (`AC...`). */
  account_sid: string;
  /** Twilio Auth Token. */
  auth_token: string;
  /** SMS-capable sender: an E.164 number (+1...) or a Messaging Service SID (MG...). */
  from: string;
}

interface InjectedDependencies {
  logger: Logger;
}

interface TwilioSuccessBody {
  sid?: string;
}

interface TwilioErrorBody {
  message?: string;
  code?: number;
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

export class TwilioNotificationService extends AbstractNotificationProviderService {
  static identifier = "notification-twilio";

  private readonly options_: TwilioOptions;
  private readonly logger_: Logger;

  constructor({ logger }: InjectedDependencies, options: TwilioOptions) {
    super();
    this.options_ = options;
    this.logger_ = logger;
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.account_sid) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Twilio notification provider requires 'account_sid' (TWILIO_ACCOUNT_SID)."
      );
    }
    if (!options.auth_token) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Twilio notification provider requires 'auth_token' (TWILIO_AUTH_TOKEN)."
      );
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Twilio notification provider requires 'from' (TWILIO_FROM_NUMBER: an E.164 number or a Messaging Service SID)."
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

    // SMS is plain text. Prefer content.text; fall back to subject so a caller
    // that only set a subject still delivers something meaningful.
    const content = notification.content;
    const bodyText = (content?.text || content?.subject || "").toString().trim();
    if (!bodyText) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `SMS notification '${notification.template}' must carry a text body.`
      );
    }

    // A Messaging Service SID (MG...) uses MessagingServiceSid; anything else is
    // treated as a plain sender number.
    const sender = (notification.from?.trim() || this.options_.from).trim();
    const usesMessagingService = /^MG[0-9a-fA-F]{32}$/.test(sender);

    const url = `${TWILIO_API_BASE}/${encodeURIComponent(this.options_.account_sid)}/Messages.json`;
    const auth = Buffer.from(
      `${this.options_.account_sid}:${this.options_.auth_token}`
    ).toString("base64");

    const results: string[] = [];
    // Twilio sends to one recipient per request; loop so a multi-recipient
    // notification (customer + admin) still works.
    for (const recipient of to) {
      const form = new URLSearchParams();
      form.set("To", recipient);
      form.set("Body", bodyText);
      if (usesMessagingService) {
        form.set("MessagingServiceSid", sender);
      } else {
        form.set("From", sender);
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
      } catch (error) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Could not reach the Twilio API: ${(error as Error).message}`
        );
      }

      const respBody = (await response.json().catch(() => ({}))) as
        | TwilioSuccessBody
        | TwilioErrorBody;

      if (!response.ok) {
        const detail = (respBody as TwilioErrorBody).message ?? "unknown error";
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Twilio rejected the SMS (${response.status}): ${detail}`
        );
      }

      const sid = (respBody as TwilioSuccessBody).sid;
      results.push(sid ?? "no-sid");
      this.logger_.info(
        `[notification-twilio] sent '${notification.template}' to ${recipient} (${sid ?? "no sid"})`
      );
    }

    // Medusa expects a single id; join when more than one message was sent.
    return { id: results.join(",") };
  }
}

export default TwilioNotificationService;
